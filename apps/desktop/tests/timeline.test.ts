// A timeline you are reading is not rebuilt underneath you.
//
// The bug: the pager reset its list whenever its key changed, and the key
// included the sync tick, which rises after every round that brought
// anything. A few seconds into scrolling the list emptied, a skeleton
// flashed, the reading position was lost and every picture on screen was
// fetched again — while the content itself was arriving perfectly well.
//
// The rule that replaced it: a *different* timeline resets; the *same*
// timeline merges. New posts go on top, old below, and they wait behind a
// count unless the top of the list is already on screen.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(DESKTOP, ...p), "utf8");
const flat = (s: string) => s.replace(/^[ \t]*(\/\/\/|\/\/!|\/\/)[ \t]?/gm, "").replace(/\s+/g, " ");

const feed = read("src", "routes", "feed", "Feed.tsx");
const pulse = read("src", "routes", "pulse", "Pulse.tsx");

describe("the pager", () => {
  it("separates which timeline this is from when it was refreshed", () => {
    expect(feed).toMatch(/identity: \(\) => unknown,\s*\n\s*refresh\?: \(\) => unknown,/);
  });

  it("resets only when the timeline itself changes", () => {
    const reset = feed.slice(feed.indexOf("onSource(identity"), feed.indexOf("onSource(\n      () => refresh"));
    expect(reset).toMatch(/setItems\(\[\]\)/);
    // The refresh path has no clear in it at all.
    const merge = feed.slice(feed.indexOf("const merge = async"), feed.indexOf("/** Puts the held-back posts"));
    expect(merge).not.toMatch(/setItems\(\[\]\)|setLoading\(true\)/);
  });

  it("keeps the posts already on screen, so they are not re-rendered", () => {
    expect(feed).toMatch(/setItems\(\[\.\.\.fresh, \.\.\.items\(\)\]\)/);
  });

  it("does not turn a failed background refresh into an error box", () => {
    expect(flat(feed)).toMatch(/Keep what is on screen/);
  });

  it("holds new posts back unless the top of the list is visible", () => {
    expect(feed).toMatch(/if \(atTop\(\)\) setItems/);
    expect(feed).toMatch(/else setWaiting/);
    expect(feed).toMatch(/export function NewPosts/);
  });

  it("does not ask a node for the first page on every sync round", () => {
    expect(feed).toMatch(/now - lastMerge < 15_000/);
  });
});

describe("Pulse uses it that way", () => {
  it("Latest is one timeline refreshed in place", () => {
    expect(pulse).toMatch(/\(\) => "latest",\s*\n\s*\(\) => store\.ticks\(\)\.feed,/);
  });

  it("a hashtag page is a different timeline, refreshed in place", () => {
    expect(pulse).toMatch(/\(\) => props\.tag,\s*\n\s*\(\) => store\.ticks\(\)\.feed,/);
  });

  it("both mark the top of their list and offer the new posts", () => {
    expect([...pulse.matchAll(/ref=\{pages\.topMark\}/g)]).toHaveLength(2);
    expect([...pulse.matchAll(/<NewPosts count=\{pages\.waiting\(\)\}/g)]).toHaveLength(2);
  });
});

describe("chat encryption keys other clients accept", () => {
  const mls = readFileSync(join(DESKTOP, "..", "..", "node", "hashgram-mls", "src", "lib.rs"), "utf8");
  const messaging = readFileSync(
    join(DESKTOP, "..", "..", "sdk", "rust", "hashgram-sdk", "src", "messaging.rs"),
    "utf8",
  );

  it("a last-resort key package declares the extension it uses", () => {
    expect(mls).toMatch(/Some\(&\[ExtensionType::LastResort\]\)/);
    expect(flat(mls)).toMatch(/RFC 9420 requires every extension in a KeyPackage to appear/);
  });

  it("another client's validation is what the test checks, not our own", () => {
    expect(mls).toMatch(/fn both_kinds_of_key_package_are_accepted_by_another_client/);
  });

  it("a key package cached by the broken build is replaced, not waited out", () => {
    expect(messaging).toMatch(/pub const LAST_RESORT_VERSION: u32 = 2/);
    expect(messaging).toMatch(/lr\.version >= LAST_RESORT_VERSION/);
  });

  it("the failure reads as something a person can act on", () => {
    expect(mls).toMatch(/StaleKeyPackage/);
    expect(flat(mls)).toMatch(/both of you need Hashgram One 1\.6 or newer/);
  });
});

describe("a client is never asked to serve", () => {
  const link = readFileSync(join(DESKTOP, "..", "..", "sdk", "rust", "hashgram-sdk", "src", "link.rs"), "utf8");

  it("peers with no role are not chosen to answer", () => {
    expect(link).toMatch(/pub fn serves\(peer: &KnownPeer\) -> bool/);
    expect(link).toMatch(/filter\(Self::serves\)/);
    expect(flat(link)).toMatch(/refused with "unsupported: this is a client"/);
  });

  it("any_peer skips them too", () => {
    const body = link.slice(link.indexOf("pub async fn any_peer"), link.indexOf("/// Sends a request to a specific peer"));
    expect(body).toMatch(/!i\.roles\.is_empty\(\)/);
  });
});
