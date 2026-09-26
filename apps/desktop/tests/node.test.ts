// Running a node. The old lifecycle asked Windows to start something and
// then asked an HTTP port whether anything was alive. These tests hold the
// two things that fixed: the app owns the process, and it does not call a
// process "running" until the node says it has peers.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(DESKTOP, ...p), "utf8");
const sup = read("src-tauri", "src", "node_supervisor.rs");

describe("the node is a child process, not a request to Windows", () => {
  it("no console window is ever created", () => {
    expect(sup).toContain("CREATE_NO_WINDOW");
    expect(sup).toMatch(/creation_flags\(CREATE_NO_WINDOW\)/);
  });

  it("start spawns the binary directly and keeps the pid", () => {
    expect(sup).toMatch(/Command::new\(&bin\)/);
    expect(sup).toMatch(/let pid = child\.id\(\)/);
    // Not "sc start" or "schtasks /Run".
    const start = sup.slice(sup.indexOf("pub fn start("), sup.indexOf("fn pipe("));
    expect(start).not.toMatch(/sc\.exe|schtasks/);
  });

  it("output is captured into a bounded buffer, not a file nobody finds", () => {
    expect(sup).toMatch(/Stdio::piped\(\)/);
    expect(sup).toMatch(/const LOG_LINES: usize = \d+/);
    expect(read("src", "components", "network", "YourNode.tsx")).toContain("View logs");
  });
});

describe("spawned is not running", () => {
  it("every state the machine can be in is named", () => {
    for (const s of [
      "NotInstalled",
      "Stopped",
      "Starting",
      "Connecting",
      "Syncing",
      "Running",
      "Degraded",
      "Stopping",
      "Crashed",
      "Error",
    ]) {
      expect(sup, s).toContain(`    ${s}`);
    }
  });

  it("Running needs peers, and no peers means Connecting", () => {
    expect(sup).toMatch(/if facts\.peers == 0 \{\s*NodeState::Connecting/);
    expect(sup).toMatch(/Nothing here reports Running until/);
  });

  it("a process that exited is Crashed, whatever it last reported", () => {
    expect(sup).toMatch(/try_wait\(\)/);
    expect(sup).toContain("NodeState::Crashed");
  });
});

describe("a failure to start is explained before it happens", () => {
  it("pre-flight covers the binary, config, folder, disk and port", () => {
    for (const name of ["Node program", "Configuration", "Data folder", "Disk space", "Port "]) {
      expect(sup, name).toContain(name);
    }
  });

  it("the screen shows the checks rather than a generic error", () => {
    const ui = read("src", "components", "network", "YourNode.tsx");
    expect(ui).toContain("Before it can start");
  });
});

describe("the dead duplicate is gone", () => {
  it("commands_node.rs no longer exists", () => {
    expect(existsSync(join(DESKTOP, "src-tauri", "src", "commands_node.rs"))).toBe(false);
  });

  it("unsafe stays in the one module allowed to have it", () => {
    expect(sup).not.toMatch(/unsafe\s*\{/);
    expect(read("src-tauri", "src", "winsec.rs")).toContain("#![allow(unsafe_code)]");
  });
});
