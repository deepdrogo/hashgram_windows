// Stories. The expiry arithmetic is tested in Rust, where it lives; what
// this file guards is the promise the interface makes about it, which is
// the part a user actually reads.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const DESKTOP = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(DESKTOP, ...p), "utf8");
const SDK = join(DESKTOP, "..", "..", "sdk", "rust", "hashgram-sdk", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([".ts", ".tsx"].includes(extname(p))) out.push(p);
  }
  return out;
}

describe("the app never claims a story was deleted", () => {
  const forbidden = /\bdisappears?\b|\bvanish/i;

  it("no screen promises the bytes are gone", () => {
    const hits: string[] = [];
    for (const f of walk(join(DESKTOP, "src"))) {
      const text = readFileSync(f, "utf8");
      if (forbidden.test(text)) hits.push(f);
      // "deleted after N hours" is the specific claim that would be false.
      if (/deleted after \d+ ?h/i.test(text)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  it("the composer explains what expiry actually does", () => {
    const stories = read("src", "components", "social", "Stories.tsx");
    expect(stories).toContain("stop showing this story");
    expect(stories).toMatch(/not deleted from machines that already hold it/);
  });

  it("the behaviour is written down where the protocol is", () => {
    const doc = readFileSync(join(DESKTOP, "..", "..", "docs", "STORIES.md"), "utf8");
    expect(doc).toContain("Expiry is a display rule, not deletion");
    expect(doc).toMatch(/the media blob has no expiry at all/);
    const proto = readFileSync(join(DESKTOP, "..", "..", "docs", "SOCIAL_PROTOCOL.md"), "utf8");
    expect(proto).toMatch(/display rule and not a\s+deletion/);
  });
});

describe("story limits match the protocol", () => {
  it("the client never offers longer than a node accepts", () => {
    const stories = read("src", "components", "social", "Stories.tsx");
    const offered = [...stories.matchAll(/\{ value: "(\d+)", label: "\d+ hours" \}/g)].map((m) => Number(m[1]));
    expect(offered.length).toBeGreaterThan(0);
    expect(Math.max(...offered)).toBeLessThanOrEqual(48);
    const limits = readFileSync(join(DESKTOP, "..", "..", "node", "hashgram-proto", "src", "limits.rs"), "utf8");
    expect(limits).toMatch(/MAX_STORY_SECS[^=]*=\s*48 \* 3600/);
    expect(readFileSync(join(SDK, "feed.rs"), "utf8")).toMatch(/STORY_MAX_SECS: u64 = 48 \* 3600/);
  });

  it("a story must carry media", () => {
    expect(readFileSync(join(SDK, "feed.rs"), "utf8")).toContain("a story needs a picture or video");
  });
});

describe("the viewer shows only what can be known", () => {
  it("there is no view count, because nothing can answer it honestly", () => {
    const stories = read("src", "components", "social", "Stories.tsx");
    expect(stories).not.toMatch(/view(er)?s?\s*count|viewed by|\bseen by\b/i);
    expect(readFileSync(join(DESKTOP, "..", "..", "docs", "STORIES.md"), "utf8")).toMatch(/viewer count .* is not implemented/i);
  });

  it("time left is rounded, not presented as an exact deadline", () => {
    expect(read("src", "components", "social", "Stories.tsx")).toContain("h left");
  });
});
