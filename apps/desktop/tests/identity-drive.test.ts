// Two promises this release makes: your address is where you read mail,
// and a file's availability is a measurement rather than a badge.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(DESKTOP, ...p), "utf8");
const SDK = join(DESKTOP, "..", "..", "sdk", "rust", "hashgram-sdk", "src");

describe("your identity is on the screen that uses it", () => {
  const mail = read("src", "routes", "mail", "Mail.tsx");

  it("Mail shows the address people write to", () => {
    expect(mail).toContain("function MailIdentity");
    expect(mail).toMatch(/@hashgram\.io/);
  });

  it("choosing a username leads to the profile, not the wallet", () => {
    expect(mail).toContain("Choose a username");
    expect(mail).toMatch(/navigate\("\/profile\/me"\)/);
    const username = read("src", "routes", "profile", "Username.tsx");
    expect(username).toMatch(/the decision belongs on the profile/);
    // The chain transaction is still the wallet's job underneath.
    expect(username).toContain("ipc.walletRegisterUsername(");
  });
});

describe("Drive availability is measured, never asserted", () => {
  it("the SDK asks providers and reports who answered", () => {
    const blob = readFileSync(join(SDK, "blob.rs"), "utf8");
    expect(blob).toMatch(/pub struct Availability/);
    expect(blob).toMatch(/pub asked: u32/);
    expect(blob).toMatch(/pub answered: u32/);
    // Prose is reflowed by rustfmt, so match it on one line.
    const flat = blob.split("\n").map((l) => l.replace(/^\s*\/\/\/?\s?/, "")).join(" ");
    expect(flat).toMatch(/not a guarantee/);
  });

  it("the screen says what it measured, and does not call it healthy", () => {
    const drive = read("src", "routes", "drive", "Drive.tsx");
    expect(drive).toContain("that answered hold a complete copy");
    expect(drive).toContain("not a survey of the network");
    expect(drive).not.toMatch(/Availability:\s*Healthy|>Healthy</);
  });

  it("an unanswered question says unknown", () => {
    expect(read("src", "routes", "drive", "Drive.tsx")).toContain("Availability unknown");
  });
});

describe("Contacts is the address book, not a directory of strangers", () => {
  it("the screen says where discovery happens instead", () => {
    const contacts = read("src", "routes", "People.tsx");
    expect(contacts).toMatch(/Discovering strangers happens in Pulse and Topics/);
  });

  it("a contact card leads to the profile, a chat and mail", () => {
    const contacts = read("src", "routes", "People.tsx");
    expect(contacts).toContain("ipc.chatOpen(props.address)");
    expect(contacts).toMatch(/navigate\(`\/profile\/\$\{props\.address\}`\)/);
  });
});
