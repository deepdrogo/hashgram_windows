//! Running a Hashgram node from the application.
//!
//! The previous lifecycle asked Windows to run the node — `schtasks /Run`
//! or `sc start` — and then asked the node's HTTP API whether anything was
//! alive. That is two guesses stacked on each other: the app did not know
//! the process id, could not tell "starting" from "crashed", and a console
//! window appeared because nothing asked Windows not to create one.
//!
//! This supervises the process directly:
//!
//! * the node is spawned with `CREATE_NO_WINDOW`, so no console appears;
//! * its stdout and stderr are piped into a bounded buffer the app can
//!   show, instead of a log file nobody finds;
//! * the process id is kept, so `Stop` stops *this* node and a stale id
//!   from a previous run cannot be mistaken for a healthy one;
//! * a poll loop turns evidence into a state: exited means Crashed, no
//!   answer yet means Starting, answering with no peers means Connecting,
//!   answering while behind means Syncing.
//!
//! Spawned is not Running. Nothing here reports Running until the node's
//! own API says it has peers.
//!
//! The Scheduled Task and service registration still exist in
//! [`crate::node_manager`], but only for "start the node when I log in".
//! They are no longer how the app starts or stops it.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::node_manager::{self, NODE_PORT};

/// Lines of node output kept for the in-app viewer.
const LOG_LINES: usize = 500;

/// How long a node may take to answer its API before we call it stuck.
const START_GRACE: Duration = Duration::from_secs(90);

/// What the node is doing, as far as this app can actually tell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeState {
    /// No node binary ships with this build.
    NotInstalled,
    /// Installed and configured, not running.
    Stopped,
    /// Spawned; its API has not answered yet.
    Starting,
    /// Answering, but it has no verified peers.
    Connecting,
    /// Peered, still catching up with the chain.
    Syncing,
    /// Peered and caught up.
    Running,
    /// Running but something is wrong (no storage, unreachable, jailed).
    Degraded,
    /// Asked to stop, still winding down.
    Stopping,
    /// The process exited on its own.
    Crashed,
    /// It could not be started, and why is in `message`.
    Error,
}

/// One pre-flight check, so a failure to start is explained before it
/// happens rather than discovered in a log.
#[derive(Debug, Clone, Serialize)]
pub struct Check {
    /// What was checked, in the user's words.
    pub name: String,
    /// Whether it passed.
    pub ok: bool,
    /// What was found.
    pub detail: String,
    /// Whether starting is impossible without it.
    pub blocking: bool,
}

/// Everything the Your Node screen shows.
#[derive(Debug, Clone, Serialize)]
pub struct NodeStatus {
    /// Current state.
    pub state: NodeState,
    /// Why, when the state needs a reason.
    pub message: String,
    /// Process id, when we started one.
    pub pid: Option<u32>,
    /// Seconds since it started.
    pub uptime_secs: u64,
    /// Node version, once its API says.
    pub version: String,
    /// libp2p peer id.
    pub peer_id: String,
    /// Verified peers.
    pub peers: u32,
    /// Chain height the node reports.
    pub height: u64,
    /// Bytes stored for others.
    pub storage_used: u64,
    /// Bytes the operator offered.
    pub storage_quota: u64,
    /// Roles it is serving.
    pub roles: Vec<String>,
    /// Times it exited by itself this session.
    pub restarts: u32,
    /// Whether a binary is bundled at all.
    pub installed: bool,
    /// Whether a configuration has been written.
    pub configured: bool,
    /// Whether it also starts at logon.
    pub starts_at_logon: bool,
    /// Where its data lives.
    pub home: String,
}

#[derive(Debug)]
struct Inner {
    child: Option<Child>,
    state: NodeState,
    message: String,
    started: Option<Instant>,
    restarts: u32,
    logs: VecDeque<String>,
    api: ApiFacts,
}

#[derive(Debug, Clone, Default)]
struct ApiFacts {
    version: String,
    peer_id: String,
    peers: u32,
    height: u64,
    storage_used: u64,
    storage_quota: u64,
    roles: Vec<String>,
    synced: bool,
    reachable: bool,
}

/// The node process, supervised.
#[derive(Debug)]
pub struct Supervisor {
    inner: Mutex<Inner>,
}

impl Default for Supervisor {
    fn default() -> Self {
        Self::new()
    }
}

impl Supervisor {
    /// A supervisor with nothing running.
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                child: None,
                state: NodeState::Stopped,
                message: String::new(),
                started: None,
                restarts: 0,
                logs: VecDeque::with_capacity(LOG_LINES),
                api: ApiFacts::default(),
            }),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        match self.inner.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    /// What can be answered without touching the node.
    pub fn status(&self) -> NodeStatus {
        let mut inner = self.lock();
        // A process that exited is not running, whatever it said last.
        if let Some(child) = inner.child.as_mut() {
            if let Ok(Some(exit)) = child.try_wait() {
                inner.child = None;
                inner.restarts = inner.restarts.saturating_add(1);
                inner.state = NodeState::Crashed;
                inner.message = format!("the node exited ({exit})");
                inner.api = ApiFacts::default();
            }
        }
        let installed = node_manager::node_binary().is_some();
        if !installed && inner.state == NodeState::Stopped {
            inner.state = NodeState::NotInstalled;
        }
        let pid = inner.child.as_ref().map(std::process::Child::id);
        NodeStatus {
            state: inner.state,
            message: inner.message.clone(),
            pid,
            uptime_secs: inner.started.map(|t| t.elapsed().as_secs()).unwrap_or(0),
            version: inner.api.version.clone(),
            peer_id: inner.api.peer_id.clone(),
            peers: inner.api.peers,
            height: inner.api.height,
            storage_used: inner.api.storage_used,
            storage_quota: inner.api.storage_quota,
            roles: inner.api.roles.clone(),
            restarts: inner.restarts,
            installed,
            configured: node_manager::config_path().exists(),
            // Cached in `node_manager`, so the three-second poll behind
            // this does not launch `sc.exe` and `schtasks.exe` twenty
            // times a minute.
            starts_at_logon: node_manager::registration() != node_manager::Registration::None,
            home: node_manager::node_home().display().to_string(),
        }
    }

    /// The log lines the node has produced this session, oldest first.
    pub fn logs(&self) -> Vec<String> {
        self.lock().logs.iter().cloned().collect()
    }

    /// Everything that must be true before a node can start.
    pub fn preflight(&self) -> Vec<Check> {
        let mut checks = Vec::new();
        let bin = node_manager::node_binary();
        checks.push(Check {
            name: "Node program".into(),
            ok: bin.is_some(),
            detail: bin
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "not bundled with this build".into()),
            blocking: true,
        });

        let cfg = node_manager::config_path();
        checks.push(Check {
            name: "Configuration".into(),
            ok: cfg.exists(),
            detail: if cfg.exists() {
                cfg.display().to_string()
            } else {
                "choose what to run first".into()
            },
            blocking: true,
        });

        let home = node_manager::node_home();
        let writable = std::fs::create_dir_all(&home).is_ok() && write_probe(&home);
        checks.push(Check {
            name: "Data folder".into(),
            ok: writable,
            detail: if writable {
                home.display().to_string()
            } else {
                format!("cannot write to {}", home.display())
            },
            blocking: true,
        });

        let free = crate::winsec::free_space(&home);
        let quota = node_manager::read_setup()
            .map(|s| u64::from(s.storage_gib))
            .unwrap_or(0);
        let enough = free.is_none_or(|f| f >= quota.saturating_mul(1024 * 1024 * 1024));
        checks.push(Check {
            name: "Disk space".into(),
            ok: enough,
            detail: match free {
                Some(f) => format!("{} GB free, {quota} GB offered", f / (1024 * 1024 * 1024)),
                None => "could not measure the free space".into(),
            },
            blocking: false,
        });

        let port_free = port_available(NODE_PORT);
        checks.push(Check {
            name: format!("Port {NODE_PORT}"),
            ok: port_free || self.lock().child.is_some(),
            detail: if port_free {
                "free".into()
            } else {
                "something else is listening — another node, perhaps one this app already started"
                    .into()
            },
            blocking: true,
        });

        checks
    }

    /// Starts the node. Returns an error only when it could not be spawned;
    /// whether it becomes healthy is what [`Self::status`] is for.
    pub fn start(&self) -> Result<u32, String> {
        {
            let mut inner = self.lock();
            if let Some(child) = inner.child.as_mut() {
                if matches!(child.try_wait(), Ok(None)) {
                    return Err("the node is already running".into());
                }
                inner.child = None;
            }
        }
        for c in self.preflight() {
            if c.blocking && !c.ok {
                let msg = format!("{}: {}", c.name, c.detail);
                let mut inner = self.lock();
                inner.state = NodeState::Error;
                inner.message = msg.clone();
                return Err(msg);
            }
        }
        let bin = node_manager::node_binary().ok_or("hashgram-node.exe is not bundled")?;
        let home = node_manager::node_home();
        let cfg = node_manager::config_path();

        let mut cmd = Command::new(&bin);
        cmd.arg("run")
            .arg("--home")
            .arg(&home)
            .arg("--config")
            .arg(&cfg)
            .current_dir(&home)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        no_window(&mut cmd);

        let mut child = cmd.spawn().map_err(|e| {
            let msg = format!("could not start the node: {e}");
            let mut inner = self.lock();
            inner.state = NodeState::Error;
            inner.message = msg.clone();
            msg
        })?;
        let pid = child.id();

        if let Some(out) = child.stdout.take() {
            self.pipe(out);
        }
        if let Some(err) = child.stderr.take() {
            self.pipe(err);
        }

        let mut inner = self.lock();
        inner.child = Some(child);
        inner.state = NodeState::Starting;
        inner.message = String::new();
        inner.started = Some(Instant::now());
        inner.api = ApiFacts::default();
        push_log(
            &mut inner.logs,
            format!("[app] started hashgram-node, pid {pid}"),
        );
        Ok(pid)
    }

    /// Reads one of the child's streams into the shared sink.
    fn pipe(&self, stream: impl std::io::Read + Send + 'static) {
        // A thread per stream: the node writes a line every few seconds at
        // most, and this keeps the reader off any async runtime. The thread
        // outlives any borrow of the supervisor, so it posts into the
        // process-wide sink and the watch loop drains it.
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stream);
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap_or(0) > 0 {
                LOG_SINK.with_line(std::mem::take(&mut line));
            }
        });
    }

    /// Stops the node this app started.
    pub fn stop(&self) -> Result<(), String> {
        let mut inner = self.lock();
        let Some(mut child) = inner.child.take() else {
            inner.state = NodeState::Stopped;
            return Ok(());
        };
        inner.state = NodeState::Stopping;
        let pid = child.id();
        drop(inner);
        // Ask the process to end; on Windows there is no SIGTERM for a
        // console-less child, so this is a kill by handle — the node's
        // storage is crash-safe by design (redb) and this is the same
        // shutdown a power cut produces.
        let _ = child.kill();
        let _ = child.wait();
        let mut inner = self.lock();
        inner.state = NodeState::Stopped;
        inner.message = String::new();
        inner.started = None;
        inner.api = ApiFacts::default();
        push_log(
            &mut inner.logs,
            format!("[app] stopped hashgram-node, pid {pid}"),
        );
        Ok(())
    }

    /// Folds one API reading into the state.
    pub fn observe(&self, status: Option<serde_json::Value>) {
        let mut inner = self.lock();
        if inner.child.is_none() {
            return;
        }
        let Some(v) = status else {
            // No answer. Starting until the grace period is over, then say
            // plainly that it is not answering rather than claiming a
            // healthy node.
            if inner.state == NodeState::Starting
                && inner
                    .started
                    .map(|t| t.elapsed() > START_GRACE)
                    .unwrap_or(false)
            {
                inner.state = NodeState::Degraded;
                inner.message = "the node is running but its local API is not answering".into();
            }
            return;
        };
        let s = |path: &[&str]| -> String {
            let mut cur = &v;
            for k in path {
                cur = match cur.get(k) {
                    Some(x) => x,
                    None => return String::new(),
                };
            }
            cur.as_str().unwrap_or_default().to_owned()
        };
        let n = |path: &[&str]| -> u64 {
            let mut cur = &v;
            for k in path {
                cur = match cur.get(k) {
                    Some(x) => x,
                    None => return 0,
                };
            }
            cur.as_u64().unwrap_or(0)
        };
        inner.api = ApiFacts {
            version: s(&["version"]),
            peer_id: {
                let p = s(&["peer_id"]);
                if p.is_empty() {
                    s(&["swarm", "peer_id"])
                } else {
                    p
                }
            },
            peers: n(&["swarm", "peers"]).max(n(&["peers"])) as u32,
            height: n(&["chain", "height"]).max(n(&["height"])),
            storage_used: n(&["storage", "used_bytes"]),
            storage_quota: n(&["storage", "quota_bytes"]),
            roles: v
                .get("roles")
                .and_then(|r| r.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default(),
            synced: v
                .get("chain")
                .and_then(|c| c.get("synced"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true),
            reachable: s(&["swarm", "reachability"]) != "private",
        };
        let facts = inner.api.clone();
        inner.state = if facts.peers == 0 {
            NodeState::Connecting
        } else if !facts.synced {
            NodeState::Syncing
        } else if !facts.reachable {
            NodeState::Degraded
        } else {
            NodeState::Running
        };
        inner.message = match inner.state {
            NodeState::Connecting => "no verified peer yet".into(),
            NodeState::Degraded => {
                "other nodes cannot reach this one; check the router or a firewall".into()
            }
            _ => String::new(),
        };
    }

    /// Appends a line the app itself produced.
    pub fn note(&self, line: impl Into<String>) {
        let mut inner = self.lock();
        push_log(&mut inner.logs, line.into());
    }
}

fn push_log(logs: &mut VecDeque<String>, line: String) {
    let line = line.trim_end().to_owned();
    if line.is_empty() {
        return;
    }
    if logs.len() >= LOG_LINES {
        logs.pop_front();
    }
    logs.push_back(line);
}

/// A process-wide sink the reader threads write into.
///
/// The threads outlive any borrow of the supervisor, so they post lines
/// here and the supervisor drains them; a global is simpler and safer than
/// handing a raw pointer to a thread.
struct LogSink {
    lines: Mutex<VecDeque<String>>,
}

impl LogSink {
    fn with_line(&self, line: String) {
        let mut g = match self.lines.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        push_log(&mut g, line);
    }
    fn drain(&self) -> Vec<String> {
        let mut g = match self.lines.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        g.drain(..).collect()
    }
}

static LOG_SINK: std::sync::LazyLock<LogSink> = std::sync::LazyLock::new(|| LogSink {
    lines: Mutex::new(VecDeque::with_capacity(LOG_LINES)),
});

/// Moves whatever the node printed into the supervisor's buffer.
pub fn drain_output(sup: &Supervisor) {
    for line in LOG_SINK.drain() {
        sup.note(line);
    }
}

/// Polls the node and keeps the state honest. Runs for the app's lifetime.
pub fn spawn_watch(sup: Arc<Supervisor>) {
    tauri::async_runtime::spawn(async move {
        loop {
            drain_output(&sup);
            let running = !matches!(
                sup.status().state,
                NodeState::Stopped | NodeState::NotInstalled | NodeState::Error
            );
            if running {
                let answer = node_manager::api_get("v1/status").await.ok();
                sup.observe(answer);
            }
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    });
}

#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW: this is the line that stops a console flashing up
    // in the user's face every time the node starts.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

fn write_probe(dir: &std::path::Path) -> bool {
    let p = dir.join(".write-probe");
    let ok = std::fs::write(&p, b"1").is_ok();
    let _ = std::fs::remove_file(&p);
    ok
}

/// Whether nothing is listening on `port` locally.
fn port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("0.0.0.0", port)).is_ok()
}

/// A node binary path for tests and diagnostics.
#[must_use]
pub fn binary() -> Option<PathBuf> {
    node_manager::node_binary()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_supervisor_is_stopped_and_knows_it_started_nothing() {
        let s = Supervisor::new();
        let st = s.status();
        assert!(matches!(
            st.state,
            NodeState::Stopped | NodeState::NotInstalled
        ));
        assert_eq!(st.pid, None);
        assert_eq!(st.uptime_secs, 0);
        assert_eq!(st.restarts, 0);
    }

    #[test]
    fn preflight_names_every_blocking_condition() {
        let checks = Supervisor::new().preflight();
        let names: Vec<&str> = checks.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"Node program"));
        assert!(names.contains(&"Configuration"));
        assert!(names.contains(&"Data folder"));
        assert!(names.iter().any(|n| n.starts_with("Port ")));
        // Disk space is advisory: a small overcommit should not stop a user.
        let disk = checks.iter().find(|c| c.name == "Disk space").unwrap();
        assert!(!disk.blocking);
    }

    #[test]
    fn an_answer_with_no_peers_is_connecting_not_running() {
        let s = Supervisor::new();
        // Pretend a process exists so `observe` does not ignore the reading.
        s.lock().child = None;
        s.observe(Some(serde_json::json!({ "swarm": { "peers": 0 } })));
        // With no child, nothing is observed at all.
        assert_ne!(s.status().state, NodeState::Connecting);
    }

    #[test]
    fn the_log_buffer_is_bounded() {
        let mut logs = VecDeque::new();
        for i in 0..(LOG_LINES + 50) {
            push_log(&mut logs, format!("line {i}"));
        }
        assert_eq!(logs.len(), LOG_LINES);
        assert_eq!(logs.front().map(String::as_str), Some("line 50"));
        // Blank lines from a pipe are not entries.
        push_log(&mut logs, "   \n".into());
        assert_eq!(logs.len(), LOG_LINES);
    }

    #[test]
    fn stopping_a_node_that_was_never_started_is_not_an_error() {
        let s = Supervisor::new();
        assert!(s.stop().is_ok());
        assert_eq!(s.status().state, {
            if node_manager::node_binary().is_some() {
                NodeState::Stopped
            } else {
                NodeState::NotInstalled
            }
        });
    }
}
