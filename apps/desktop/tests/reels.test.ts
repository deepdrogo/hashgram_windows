// Reels show what people actually posted, in the order it happened.
//
// The failure this guards against is the obvious one: a short-video surface
// invites a hidden ranking, and a hidden ranking is the thing this network
// exists to avoid. Reels are therefore the public timeline filtered to
// video, newest first, and the screen says so.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
// Prose is wrapped and prefixed with comment markers, so a sentence is
// matched after the markers and the line breaks are taken back out.
const flat = (s: string) => s.replace(/^\s*(\/\/!?|\/\/\/|\/\/)\s?/gm, "").replace(/\s+/g, " ");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Reels", () => {
  const reels = read("src", "routes", "pulse", "Reels.tsx");

  it("lives inside Pulse", () => {
    const pulse = read("src", "routes", "pulse", "Pulse.tsx");
    expect(pulse).toMatch(/id: "reels", label: "Reels"/);
    expect(pulse).toMatch(/from "\.\/Reels"/);
  });

  it("takes video from ordinary posts too, not just REEL_CREATE", () => {
    expect(reels).toMatch(/mime.startsWith\("video\/"\)/);
    expect(flat(reels)).toMatch(/videos people attach to ordinary posts/i);
  });

  it("orders by time and says there is no ranking", () => {
    expect(flat(reels)).toMatch(/newest first, no ranking/);
    expect(code(reels)).not.toMatch(/\bscore\b|engagement|algorithm/i);
  });

  it("shows no view counts, because nothing counts views", () => {
    expect(reels).not.toMatch(/views/i);
  });

  it("warms the next few videos so moving down does not stall", () => {
    expect(reels).toMatch(/prefetchMedia/);
  });

  it("says plainly when a video is not on a reachable node", () => {
    expect(flat(reels)).toMatch(/not on a reachable node/i);
  });
});

describe("the transactions page", () => {
  const tx = read("src", "components", "network", "Transactions.tsx");

  it("searches one box for a hash, an account or a memo", () => {
    expect(tx).toMatch(/Transaction hash, hash1… account, or a memo/);
  });

  it("does not present an indexer as an authority", () => {
    expect(flat(tx)).toMatch(/read model over the chain/i);
  });

  it("distinguishes 'nothing matched' from 'nobody answered'", () => {
    expect(tx).toMatch(/No indexer answered/);
    expect(tx).toMatch(/Nothing matched/);
  });

  it("warns that a memo is public", () => {
    expect(flat(tx)).toMatch(/not a private note/i);
  });
});

describe("the public Spaces directory", () => {
  const dir = read("src", "routes", "spaces", "Discover.tsx");
  const rs = read("src-tauri", "src", "cmd_spaces.rs");

  it("sorts by category and by popularity", () => {
    expect(rs).toMatch(/pub async fn spaces_directory/);
    expect(dir).toMatch(/Most active/);
    expect(dir).toMatch(/Newest/);
  });

  it("never claims the group itself became public", () => {
    expect(flat(dir)).toMatch(/A listing is public; the Space is not/);
    expect(flat(rs)).toMatch(/cannot mean opening the group/i);
  });

  it("labels popularity as one node's count", () => {
    expect(flat(rs)).toMatch(/counted by the node that answered/i);
    expect(dir).toMatch(/counted by the node that answered/);
  });

  it("joining is the owner's decision", () => {
    expect(dir).toMatch(/Ask to join/);
  });

  it("the listing convention is documented, not hidden", () => {
    expect(rs).toMatch(/docs\/SPACES\.md/);
  });
});
