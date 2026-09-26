//! The UI-cache database: SQLite in WAL mode, one connection behind a
//! mutex. It holds nothing the SDK's encrypted store (`local.redb`) holds:
//! submitted transactions the wallet screen watches, recent searches, and
//! sealed per-key UI values (list orderings, thumbnails metadata). A private
//! value goes through `crate::crypto::seal` with the vault-held key before
//! it is written; a test scans the file for a test secret and fails if it
//! is found.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};

use crate::crypto::DbKey;

/// The database handle.
pub struct Db {
    conn: Mutex<Connection>,
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_tx (
    hash       TEXT PRIMARY KEY,
    submitted  INTEGER NOT NULL,
    summary    TEXT NOT NULL,
    state      TEXT NOT NULL,
    height     INTEGER NOT NULL DEFAULT 0,
    raw_log    TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS recent_search (
    query   TEXT PRIMARY KEY,
    at      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ui_sealed (
    key     TEXT PRIMARY KEY,
    sealed  BLOB NOT NULL,
    updated INTEGER NOT NULL
);
-- Chat history. The SDK keeps MLS state but no transcript, so this is
-- where a conversation lives between runs. Everything a person wrote is
-- in `sealed`, encrypted under the vault-held key with the message id as
-- associated data; the clear columns are only what an index needs.
CREATE TABLE IF NOT EXISTS chat_message (
    id         TEXT PRIMARY KEY,
    group_id   TEXT NOT NULL,
    sender     TEXT NOT NULL,
    at_ms      INTEGER NOT NULL,
    outgoing   INTEGER NOT NULL DEFAULT 0,
    state      TEXT NOT NULL DEFAULT 'sent',
    sealed     BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_message_group ON chat_message(group_id, at_ms);
CREATE TABLE IF NOT EXISTS chat_read (
    group_id   TEXT PRIMARY KEY,
    read_at_ms INTEGER NOT NULL
);
"#;

impl Db {
    /// Opens (creating) the database with WAL and a busy timeout.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;",
        )
        .map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Runs `f` with the connection.
    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "database lock poisoned".to_owned())?;
        f(&conn).map_err(|e| e.to_string())
    }

    /// Stores a public meta value.
    pub fn meta_set(&self, key: &str, value: &[u8]) -> Result<(), String> {
        self.with(|c| {
            c.execute(
                "INSERT INTO meta(key, value) VALUES(?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map(|_| ())
        })
    }

    /// Reads a public meta value.
    pub fn meta_get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        self.with(|c| {
            c.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
                r.get::<_, Vec<u8>>(0)
            })
            .optional()
        })
    }

    /// Stores a sealed UI value under `key` (AAD = key).
    pub fn sealed_put(&self, db_key: &DbKey, key: &str, json: &[u8]) -> Result<(), String> {
        let sealed = crate::crypto::seal(db_key, key.as_bytes(), json)?;
        self.with(|c| {
            c.execute(
                "INSERT INTO ui_sealed(key, sealed, updated) VALUES(?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET sealed = excluded.sealed, updated = excluded.updated",
                params![key, sealed, now()],
            )
            .map(|_| ())
        })
    }

    /// Reads a sealed UI value.
    pub fn sealed_get(&self, db_key: &DbKey, key: &str) -> Result<Option<Vec<u8>>, String> {
        let sealed: Option<Vec<u8>> = self.with(|c| {
            c.query_row(
                "SELECT sealed FROM ui_sealed WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()
        })?;
        match sealed {
            Some(s) => Ok(Some(crate::crypto::open(db_key, key.as_bytes(), &s)?)),
            None => Ok(None),
        }
    }

    /// Records a submitted transaction.
    pub fn pending_put(&self, hash: &str, summary: &str, state: &str) -> Result<(), String> {
        self.with(|c| {
            c.execute(
                "INSERT INTO pending_tx(hash, submitted, summary, state) VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(hash) DO UPDATE SET state = excluded.state",
                params![hash, now(), summary, state],
            )
            .map(|_| ())
        })
    }

    /// Updates a transaction's state.
    pub fn pending_update(
        &self,
        hash: &str,
        state: &str,
        height: u64,
        raw_log: &str,
    ) -> Result<(), String> {
        self.with(|c| {
            c.execute(
                "UPDATE pending_tx SET state = ?2, height = ?3, raw_log = ?4 WHERE hash = ?1",
                params![hash, state, height as i64, raw_log],
            )
            .map(|_| ())
        })
    }

    /// Recent transactions this app submitted, newest first.
    pub fn pending_list(&self, limit: usize) -> Result<Vec<PendingRow>, String> {
        self.with(|c| {
            let mut st = c.prepare(
                "SELECT hash, submitted, summary, state, height, raw_log FROM pending_tx
                 ORDER BY submitted DESC LIMIT ?1",
            )?;
            let rows = st.query_map(params![limit as i64], |r| {
                Ok(PendingRow {
                    hash: r.get(0)?,
                    submitted: r.get::<_, i64>(1)? as u64,
                    summary: r.get(2)?,
                    state: r.get(3)?,
                    height: r.get::<_, i64>(4)? as u64,
                    raw_log: r.get(5)?,
                })
            })?;
            rows.collect()
        })
    }

    /// Stores one chat message. The text is sealed; only the ids, the
    /// sender and the time stay readable, because an index needs them.
    pub fn chat_put(&self, db_key: &DbKey, m: &ChatRow) -> Result<(), String> {
        let sealed = crate::crypto::seal(db_key, m.id.as_bytes(), m.text.as_bytes())?;
        self.with(|c| {
            c.execute(
                "INSERT INTO chat_message(id, group_id, sender, at_ms, outgoing, state, sealed)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET state = excluded.state",
                params![
                    m.id,
                    m.group_id,
                    m.sender,
                    m.at_ms as i64,
                    i64::from(m.outgoing),
                    m.state,
                    sealed
                ],
            )
            .map(|_| ())
        })
    }

    /// Marks a message we sent as delivered, failed or queued.
    pub fn chat_state(&self, id: &str, state: &str) -> Result<(), String> {
        self.with(|c| {
            c.execute(
                "UPDATE chat_message SET state = ?2 WHERE id = ?1",
                params![id, state],
            )
            .map(|_| ())
        })
    }

    /// One conversation's messages, oldest first, ending at `before_ms`.
    pub fn chat_page(
        &self,
        db_key: &DbKey,
        group_id: &str,
        before_ms: u64,
        limit: usize,
    ) -> Result<Vec<ChatRow>, String> {
        let before = if before_ms == 0 {
            i64::MAX
        } else {
            before_ms as i64
        };
        let mut rows: Vec<(ChatRow, Vec<u8>)> = self.with(|c| {
            let mut st = c.prepare(
                "SELECT id, group_id, sender, at_ms, outgoing, state, sealed FROM chat_message
                 WHERE group_id = ?1 AND at_ms < ?2 ORDER BY at_ms DESC LIMIT ?3",
            )?;
            let it = st.query_map(params![group_id, before, limit as i64], |r| {
                Ok((
                    ChatRow {
                        id: r.get(0)?,
                        group_id: r.get(1)?,
                        sender: r.get(2)?,
                        at_ms: r.get::<_, i64>(3)? as u64,
                        outgoing: r.get::<_, i64>(4)? != 0,
                        state: r.get(5)?,
                        text: String::new(),
                    },
                    r.get::<_, Vec<u8>>(6)?,
                ))
            })?;
            let mut out = Vec::new();
            for r in it {
                out.push(r?);
            }
            Ok(out)
        })?;
        let mut messages = Vec::with_capacity(rows.len());
        for (mut row, sealed) in rows.drain(..) {
            let clear = crate::crypto::open(db_key, row.id.as_bytes(), &sealed)?;
            row.text = String::from_utf8_lossy(&clear).into_owned();
            messages.push(row);
        }
        messages.reverse();
        Ok(messages)
    }

    /// Conversations that have a message, newest activity first, with how
    /// many arrived after the last time the user read them.
    pub fn chat_overview(&self) -> Result<Vec<ChatSummaryRow>, String> {
        self.with(|c| {
            let mut st = c.prepare(
                "SELECT m.group_id,
                        MAX(m.at_ms),
                        SUM(CASE WHEN m.outgoing = 0 AND m.at_ms > COALESCE(r.read_at_ms, 0) THEN 1 ELSE 0 END)
                 FROM chat_message m
                 LEFT JOIN chat_read r ON r.group_id = m.group_id
                 GROUP BY m.group_id ORDER BY MAX(m.at_ms) DESC",
            )?;
            let rows = st.query_map([], |r| {
                Ok(ChatSummaryRow {
                    group_id: r.get(0)?,
                    last_at_ms: r.get::<_, i64>(1)? as u64,
                    unread: r.get::<_, i64>(2)? as u32,
                })
            })?;
            rows.collect()
        })
    }

    /// Remembers that everything up to `at_ms` has been read.
    pub fn chat_mark_read(&self, group_id: &str, at_ms: u64) -> Result<(), String> {
        self.with(|c| {
            c.execute(
                "INSERT INTO chat_read(group_id, read_at_ms) VALUES(?1, ?2)
                 ON CONFLICT(group_id) DO UPDATE SET read_at_ms = MAX(read_at_ms, excluded.read_at_ms)",
                params![group_id, at_ms as i64],
            )
            .map(|_| ())
        })
    }

    /// Messages that never left this device, oldest first.
    pub fn chat_queued(&self, db_key: &DbKey) -> Result<Vec<ChatRow>, String> {
        let pending: Vec<(ChatRow, Vec<u8>)> = self.with(|c| {
            let mut st = c.prepare(
                "SELECT id, group_id, sender, at_ms, outgoing, state, sealed FROM chat_message
                 WHERE state = 'queued' ORDER BY at_ms ASC LIMIT 200",
            )?;
            let it = st.query_map([], |r| {
                Ok((
                    ChatRow {
                        id: r.get(0)?,
                        group_id: r.get(1)?,
                        sender: r.get(2)?,
                        at_ms: r.get::<_, i64>(3)? as u64,
                        outgoing: r.get::<_, i64>(4)? != 0,
                        state: r.get(5)?,
                        text: String::new(),
                    },
                    r.get::<_, Vec<u8>>(6)?,
                ))
            })?;
            let mut out = Vec::new();
            for r in it {
                out.push(r?);
            }
            Ok(out)
        })?;
        let mut messages = Vec::with_capacity(pending.len());
        for (mut row, sealed) in pending {
            let clear = crate::crypto::open(db_key, row.id.as_bytes(), &sealed)?;
            row.text = String::from_utf8_lossy(&clear).into_owned();
            messages.push(row);
        }
        Ok(messages)
    }

    /// Text search inside one device's own chat history. Because the text
    /// is sealed, this decrypts as it goes — which is exactly why it never
    /// leaves the machine.
    pub fn chat_search(
        &self,
        db_key: &DbKey,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ChatRow>, String> {
        let needle = query.to_lowercase();
        let mut hits = Vec::new();
        for summary in self.chat_overview()? {
            for row in self.chat_page(db_key, &summary.group_id, 0, 500)? {
                if row.text.to_lowercase().contains(&needle) {
                    hits.push(row);
                    if hits.len() >= limit {
                        return Ok(hits);
                    }
                }
            }
        }
        Ok(hits)
    }

    /// Records a search.
    pub fn search_note(&self, query: &str) -> Result<(), String> {
        self.with(|c| {
            c.execute(
                "INSERT INTO recent_search(query, at) VALUES(?1, ?2)
                 ON CONFLICT(query) DO UPDATE SET at = excluded.at",
                params![query, now()],
            )?;
            c.execute(
                "DELETE FROM recent_search WHERE query NOT IN (SELECT query FROM recent_search ORDER BY at DESC LIMIT 20)",
                [],
            )
            .map(|_| ())
        })
    }

    /// Recent searches, newest first.
    pub fn search_recent(&self) -> Result<Vec<String>, String> {
        self.with(|c| {
            let mut st = c.prepare("SELECT query FROM recent_search ORDER BY at DESC LIMIT 20")?;
            let rows = st.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect()
        })
    }
}

/// One chat message as it is stored and read back. `text` is sealed on
/// disk and only ever in memory here.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ChatRow {
    /// Message id, hex.
    pub id: String,
    /// MLS group id, hex.
    pub group_id: String,
    /// Sender address.
    pub sender: String,
    /// Sender clock, ms.
    pub at_ms: u64,
    /// Whether we sent it.
    pub outgoing: bool,
    /// `sent`, `queued` or `failed`.
    pub state: String,
    /// The message.
    pub text: String,
}

/// One conversation's index entry.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ChatSummaryRow {
    /// MLS group id, hex.
    pub group_id: String,
    /// Newest message time, ms.
    pub last_at_ms: u64,
    /// Incoming messages since the user last read it.
    pub unread: u32,
}

/// A submitted transaction row.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PendingRow {
    /// Hex hash.
    pub hash: String,
    /// Unix seconds when submitted.
    pub submitted: u64,
    /// Human summary ("Send 10 HASH to hash1…").
    pub summary: String,
    /// `pending`, `committed`, `failed`.
    pub state: String,
    /// Height once committed.
    pub height: u64,
    /// Raw log on failure.
    pub raw_log: String,
}

/// Unix seconds.
#[must_use]
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("hg-db-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.join("t.db")
    }

    #[test]
    fn opens_with_wal_and_stores_sealed_values() {
        let p = tmp("wal");
        let db = Db::open(&p).unwrap();
        let mode: String = db
            .with(|c| c.query_row("PRAGMA journal_mode", [], |r| r.get(0)))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
        let key = crate::crypto::generate_key().unwrap();
        db.sealed_put(&key, "mail/order", br#"{"name":"Very Secret Friend"}"#)
            .unwrap();
        assert_eq!(
            db.sealed_get(&key, "mail/order").unwrap().unwrap(),
            br#"{"name":"Very Secret Friend"}"#
        );
        drop(db);
        let mut bytes = std::fs::read(&p).unwrap();
        if let Ok(w) = std::fs::read(p.with_extension("db-wal")) {
            bytes.extend(w);
        }
        assert!(!bytes.windows(18).any(|w| w == b"Very Secret Friend"));
    }

    fn line(id: &str, group: &str, at: u64, outgoing: bool, text: &str) -> ChatRow {
        ChatRow {
            id: id.into(),
            group_id: group.into(),
            sender: if outgoing {
                "hash1me".into()
            } else {
                "hash1alice".into()
            },
            at_ms: at,
            outgoing,
            state: if outgoing {
                "queued".into()
            } else {
                "sent".into()
            },
            text: text.into(),
        }
    }

    #[test]
    fn chat_history_is_never_written_in_the_clear() {
        let p = tmp("chat");
        let db = Db::open(&p).unwrap();
        let key = crate::crypto::generate_key().unwrap();
        db.chat_put(
            &key,
            &line("m1", "g1", 1_000, false, "Meet me at the usual place"),
        )
        .unwrap();
        let back = db.chat_page(&key, "g1", 0, 10).unwrap();
        assert_eq!(back[0].text, "Meet me at the usual place");

        drop(db);
        let mut bytes = std::fs::read(&p).unwrap();
        if let Ok(w) = std::fs::read(p.with_extension("db-wal")) {
            bytes.extend(w);
        }
        assert!(
            !bytes.windows(12).any(|w| w == b"Meet me at t"),
            "a message must not be readable in the database file"
        );
    }

    #[test]
    fn a_conversation_reads_back_oldest_first_with_its_unread_count() {
        let db = Db::open(&tmp("chat-order")).unwrap();
        let key = crate::crypto::generate_key().unwrap();
        db.chat_put(&key, &line("m1", "g1", 1_000, false, "one"))
            .unwrap();
        db.chat_put(&key, &line("m2", "g1", 2_000, true, "two"))
            .unwrap();
        db.chat_put(&key, &line("m3", "g1", 3_000, false, "three"))
            .unwrap();

        let page = db.chat_page(&key, "g1", 0, 10).unwrap();
        assert_eq!(
            page.iter().map(|m| m.text.as_str()).collect::<Vec<_>>(),
            ["one", "two", "three"]
        );

        // Two incoming, nothing read yet.
        let o = db.chat_overview().unwrap();
        assert_eq!(o.len(), 1);
        assert_eq!(o[0].unread, 2);
        assert_eq!(o[0].last_at_ms, 3_000);

        db.chat_mark_read("g1", 3_000).unwrap();
        assert_eq!(db.chat_overview().unwrap()[0].unread, 0);
        // Reading is monotonic: an older mark does not resurrect unreads.
        db.chat_mark_read("g1", 1_500).unwrap();
        assert_eq!(db.chat_overview().unwrap()[0].unread, 0);
    }

    #[test]
    fn what_did_not_go_out_stays_queued_until_it_does() {
        let db = Db::open(&tmp("chat-queue")).unwrap();
        let key = crate::crypto::generate_key().unwrap();
        db.chat_put(&key, &line("m1", "g1", 1_000, true, "sent while offline"))
            .unwrap();
        db.chat_put(&key, &line("m2", "g1", 2_000, false, "arrived"))
            .unwrap();

        let q = db.chat_queued(&key).unwrap();
        assert_eq!(q.len(), 1, "only our own undelivered message is queued");
        assert_eq!(q[0].text, "sent while offline");

        db.chat_state("m1", "sent").unwrap();
        assert!(db.chat_queued(&key).unwrap().is_empty());
    }

    #[test]
    fn searching_chats_happens_here_because_the_text_is_sealed() {
        let db = Db::open(&tmp("chat-search")).unwrap();
        let key = crate::crypto::generate_key().unwrap();
        db.chat_put(
            &key,
            &line("m1", "g1", 1_000, false, "the lighthouse stairwell"),
        )
        .unwrap();
        db.chat_put(
            &key,
            &line("m2", "g2", 2_000, true, "nothing to do with it"),
        )
        .unwrap();
        let hits = db.chat_search(&key, "LIGHTHOUSE", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].group_id, "g1");
    }

    #[test]
    fn pending_tx_lifecycle() {
        let db = Db::open(&tmp("tx")).unwrap();
        db.pending_put("ABC", "Send 1 HASH", "pending").unwrap();
        db.pending_update("ABC", "committed", 42, "").unwrap();
        let l = db.pending_list(10).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].state, "committed");
        assert_eq!(l[0].height, 42);
    }
}
