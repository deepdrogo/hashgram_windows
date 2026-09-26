// Resilience. These tests do not make the network decentralised — that is
// operations, not code. They keep the app honest about where it still has
// a single point of failure, and stop the mitigations regressing.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const DESKTOP = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(DESKTOP, ...p), "utf8");
const repo = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("one indexer is no longer a point of failure", () => {
  it("settings accept several and try them in order", () => {
    const s = read("src-tauri", "src", "settings.rs");
    expect(s).toMatch(/pub indexer_urls: Vec<String>/);
    expect(s).toMatch(/pub fn indexers\(&self\) -> Vec<&str>/);
    expect(read("src-tauri", "src", "cmd_profile.rs")).toMatch(/async fn ask_indexers/);
  });

  it("every configured URL is validated, not only the first", () => {
    const s = read("src-tauri", "src", "settings.rs");
    expect(s).toMatch(/for u in std::iter::once\(&self\.network\.indexer_url\)\s*\.chain\(&self\.network\.indexer_urls\)/s);
  });
});

describe("bootstrap can be repointed without a new installer", () => {
  it("a DNS seed name ships, and the record to publish is written down", () => {
    const dns = repo("app", "params", "mainnet", "dns_seeds.txt");
    const names = dns.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    expect(names.length).toBeGreaterThan(0);
    expect(dns).toContain("_dnsaddr.");
  });
});

describe("the failure modes are documented, not implied", () => {
  const doc = repo("docs", "FOUNDER_NODE_A_FAILURE.md");

  it("the three single points of failure are named", () => {
    expect(doc).toContain("One validator holds all the voting power");
    expect(doc).toContain("Bootstrap addresses point at one host");
    expect(doc).toMatch(/The three single points of failure/);
  });

  it("every subsystem has a verdict", () => {
    for (const s of ["Block production", "Chats — live", "Drive", "Bootstrap for new installs"]) {
      expect(doc, s).toContain(s);
    }
    expect(doc).toMatch(/\*\*BROKEN\*\*/);
    expect(doc).toMatch(/\*\*WORKS\*\*/);
    expect(doc).toMatch(/\*\*DEGRADED\*\*/);
  });

  it("it does not promise the code fixed consensus", () => {
    expect(doc).toContain("Not changed, deliberately");
    expect(doc).toMatch(/Adding validators is a governance and operations act/);
  });

  it("DECENTRALIZATION.md points at it", () => {
    expect(repo("docs", "DECENTRALIZATION.md")).toContain("FOUNDER_NODE_A_FAILURE.md");
  });
});

describe("public media is uploaded at the replication the network repairs towards", () => {
  it("the client and the node agree on three", () => {
    const sdk = repo("sdk", "rust", "hashgram-sdk", "src", "blob.rs");
    const node = repo("node", "hashgram-node", "src", "blob.rs");
    expect(sdk).toMatch(/PUBLIC_REPLICAS: usize = 3/);
    expect(node).toMatch(/TARGET_REPLICAS: u32 = 3/);
  });
});
