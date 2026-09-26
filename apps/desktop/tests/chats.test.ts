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
    const code = chatUi.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
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
    // Empty is accepted and means the default; anything else must be one
    // of the named policies.
    expect(settings).toContain('["", "everyone", "nobody"]');
    expect(read("src", "routes", "Settings.tsx")).toContain("Who can Chat with me?");
  });

  it("an upgrade from a build without the setting defaults to everyone", () => {
    const settings = read("src-tauri", "src", "settings.rs");
    // Written by hand: the derived Default would leave it empty, which
    // made every settings save fail — including the theme switch.
    expect(settings).toMatch(/impl Default for SocialSettings/);
    expect(settings).toMatch(/who_can_chat: default_who_can_chat\(\)/);
  });

  it("a refused sender is pointed at Mail", () => {
    const ui = read("src", "routes", "chats", "Chats.tsx");
    expect(ui).toContain("This user is not accepting Chats");
    expect(ui).toContain("You can contact them using HashMail");
  });
});

describe("a conversation exists when somebody uses it", () => {
  it("only registered groups are listed, not every MLS group the account has", () => {
    const rs = read("src-tauri", "src", "cmd_chat.rs");
    expect(rs).toContain("state.db.chat_registered()");
    // rustfmt reflows prose, so match it on one line.
    const flat = rs.split("\n").map((l) => l.replace(/^\s*\/\/\/?\s?/, "")).join(" ");
    expect(flat).toMatch(/contact requests, Circles, Spaces/);
    // A Space's group belongs to the Space, not to Chats.
    expect(rs).toMatch(/if kind == "space"/);
  });

  it("an incoming message is what registers the other side's conversation", () => {
    expect(read("src-tauri", "src", "cmd_chat.rs")).toMatch(
      /Somebody writing to you is what makes a conversation exist/,
    );
  });
});

describe("group chats", () => {
  const rs = read("src-tauri", "src", "cmd_chat.rs");

  it("a group is the same MLS group as a one-to-one chat, with a name", () => {
    expect(rs).toMatch(/pub async fn chat_create_group/);
    expect(rs).toMatch(/create_conversation\(&link, &chain, &network, &name, &people\)/);
  });

  it("there is a ceiling, and it points at Spaces for bigger rooms", () => {
    expect(rs).toMatch(/MAX_GROUP_MEMBERS: usize = \d+/);
    expect(rs).toMatch(/a community of hundreds belongs in a Space/i);
  });

  it("members can be added and the group can be left", () => {
    expect(rs).toMatch(/pub async fn chat_add_member/);
    expect(rs).toMatch(/pub async fn chat_leave/);
  });
});

describe("the retention warning is on the screen, not only in a doc", () => {
  it("the composer says a delete does not reach the other device", () => {
    const ui = read("src", "routes", "chats", "Chats.tsx");
    expect(ui).toMatch(/removes it from this device/);
    expect(ui).toMatch(/undelivered ciphertext sits on store nodes/);
  });
});

describe("emoji", () => {
  it("the picker is bundled, not fetched", () => {
    const picker = read("src", "components", "social", "EmojiPicker.tsx");
    expect(picker).not.toMatch(/fetch\(|http|cdn/i);
    expect(picker).toMatch(/const GROUPS/);
  });

  it("it inserts at the caret rather than appending", () => {
    expect(read("src", "routes", "chats", "Chats.tsx")).toContain("input?.selectionStart");
  });
});

describe("pictures and video in a conversation", () => {
  const rs = read("src-tauri", "src", "cmd_chat.rs");
  const sdk = readFileSync(join(DESKTOP, "..", "..", "sdk", "rust", "hashgram-sdk", "src", "messaging.rs"), "utf8");

  it("an attachment is encrypted with its own key before it leaves", () => {
    // `true` is the `private` argument of blob::upload.
    expect(sdk).toMatch(/crate::blob::upload\([^)]*true,\s*ATTACHMENT_REPLICAS/s);
    const flat = sdk.split("\n").map((l) => l.replace(/^\s*\/\/\/?\s?/, "")).join(" ");
    expect(flat).toMatch(/a store node holds ciphertext it cannot open/);
  });

  it("the key is sealed on this device and never reaches the webview", () => {
    expect(rs).toMatch(/struct AttachmentRef/);
    expect(read("src-tauri", "src", "db.rs")).toMatch(/sealed_ref/);
    // The type the UI sees carries no cid, key or nonce.
    const ipc = read("src", "lib", "ipc.ts");
    const i = ipc.indexOf("export interface ChatAttachment");
    const body = ipc.slice(i, ipc.indexOf("\n}", i));
    expect(body).not.toMatch(/\b(cid|key|nonce)\b/);
  });

  it("opening one decrypts on the Rust side into the scratch folder", () => {
    expect(rs).toMatch(/pub async fn chat_attachment_open/);
    expect(rs).toContain("crate::paths::tmp_dir()");
  });

  it("the composer can attach and the bubble shows what arrived", () => {
    const ui = read("src", "routes", "chats", "Chats.tsx");
    expect(ui).toContain("ipc.chatSendMedia(");
    expect(ui).toMatch(/function ChatAttachments/);
    expect(ui).toContain("ipc.chatAttachmentOpen(");
  });
});

describe("delivery state says only what is known", () => {
  it("queued means this device still has it; nothing claims it was read", () => {
    const ui = read("src", "routes", "chats", "Chats.tsx");
    expect(ui).toContain("Still on this device");
    expect(ui).not.toMatch(/\bread receipt|seen at|\bRead\b\s*</);
  });
});
