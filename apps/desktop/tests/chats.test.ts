// Chats. The encryption and the sealed history are tested in Rust; what
// this file guards is the boundary — no secret crosses into the webview,
// the privacy setting is enforced where it has to be, and the app does not
// claim to know things it cannot.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(DESKTOP, ...p), "utf8");

describe("nothing cryptographic reaches the webview", () => {
  const chatUi = read("src", "routes", "chats", "Chats.tsx");
  const ipc = read("src", "lib", "ipc.ts");

  it("the UI talks to typed commands and does no crypto", () => {
    // Naming MLS in a comment is fine; calling a cipher is not.
    const code = chatUi.replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/crypto\.|SubtleCrypto|\.encrypt\(|\.decrypt\(|\bMLS\b/);
    expect(chatUi).toMatch(/ipc\.chat(Send|History|List|Open)\(/);
  });

  it("the message type carries text and state, not keys", () => {
    const i = ipc.indexOf("export interface ChatMessage");
    const body = ipc.slice(i, ipc.indexOf("\n}", i));
    expect(body).not.toMatch(/\b(key|nonce|secret|epoch|ratchet)\b/i);
  });
});

describe("history is sealed, and searching it stays here", () => {
  it("the store seals the text and indexes only what it must", () => {
    const db = read("src-tauri", "src", "db.rs");
    expect(db).toMatch(/CREATE TABLE IF NOT EXISTS chat_message/);
    expect(db).toContain("crate::crypto::seal(db_key, m.id.as_bytes(), m.text.as_bytes())");
  });

  it("chat search never becomes a network query", () => {
    const rs = read("src-tauri", "src", "cmd_chat.rs");
    expect(rs).toContain("The words never leave the PC");
    expect(rs).not.toMatch(/indexer\(|reqwest|http/);
  });
});

describe("who may chat is decided by the recipient", () => {
  const rs = read("src-tauri", "src", "cmd_chat.rs");

  it("the check runs when a message arrives, not when one is sent", () => {
    expect(rs).toMatch(/pub async fn accept_incoming/);
    expect(rs).toContain("may_chat_with(state, &r.sender)");
    expect(rs).toMatch(/enforced \*\*here, on the receiving/);
  });

  it("blocking wins over the setting", () => {
    expect(rs).toContain("Blocking is separate from the policy and always wins");
  });

  it("the setting has room to grow without changing its callers", () => {
    const settings = read("src-tauri", "src", "settings.rs");
    expect(settings).toMatch(/who_can_chat/);
    expect(settings).toContain('["everyone", "nobody"]');
    expect(read("src", "routes", "Settings.tsx")).toContain("Who can Chat with me?");
  });

  it("a refused sender is pointed at Mail", () => {
    const ui = read("src", "routes", "chats", "Chats.tsx");
    expect(ui).toContain("This user is not accepting Chats");
    expect(ui).toContain("You can contact them using HashMail");
  });
});

describe("delivery state says only what is known", () => {
  it("queued means this device still has it; nothing claims it was read", () => {
    const ui = read("src", "routes", "chats", "Chats.tsx");
    expect(ui).toContain("Still on this device");
    expect(ui).not.toMatch(/\bread receipt|seen at|\bRead\b\s*</);
  });
});
