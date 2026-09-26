// Video has to look like video before anyone waits for it.
//
// The bug these tests exist to stop: a tile pointed an <img> at a video's
// bytes. An <img> decodes nothing from an MP4, so the tile hid itself and
// collapsed into a bar with a play button — after downloading the whole
// file to draw nothing at all.
//
// The rules that replaced it:
//   * a video's frame comes from a poster, or from a <video> element, never
//     from an <img>;
//   * a tile in a feed fetches the poster only, because the video is
//     megabytes and nobody has asked to watch it yet;
//   * the space a tile will occupy is reserved before the bytes arrive;
//   * a viewer plays by itself and starts silent, with sound one click away.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = join(__dirname, "..");
const SDK = join(__dirname, "..", "..", "..", "sdk", "rust", "hashgram-sdk", "src");
const read = (...p: string[]) => readFileSync(join(DESKTOP, ...p), "utf8");
const flat = (s: string) => s.replace(/^[ \t]*(\/\/\/|\/\/!|\/\/)[ \t]?/gm, "").replace(/\s+/g, " ");

const media = read("src", "components", "social", "Media.tsx");
const chats = read("src", "routes", "chats", "Chats.tsx");

describe("the poster reaches the client", () => {
  it("media carries the poster, size and duration the protocol already had", () => {
    const feed = readFileSync(join(SDK, "feed.rs"), "utf8");
    expect(feed).toMatch(/pub struct PostMedia/);
    for (const field of ["poster_cid", "width", "height", "duration_ms", "kind"]) {
      expect(feed, field).toMatch(new RegExp(`pub ${field}:`));
    }
    // The tuple that dropped them is gone.
    expect(feed).not.toMatch(/pub media: Vec<\(String, String, u64\)>/);
  });

  it("the type the UI reads says the same", () => {
    const ipc = read("src", "lib", "ipc.ts");
    expect(ipc).toMatch(/export interface PostMedia/);
    expect(ipc).toMatch(/poster_cid: string/);
    expect(ipc).not.toMatch(/media: \[string, string, number\]\[\]/);
  });
});

describe("a video tile", () => {
  it("fetches the poster, not the video", () => {
    expect(media).toMatch(/const preview = \(\) => \(video\(\) \? props\.media\.poster_cid : props\.media\.cid\)/);
    expect(flat(media)).toMatch(/A video tile loads the \*\*poster\*\* and nothing else/);
  });

  it("never puts video bytes in an img", () => {
    // The only <img> in a tile is fed by `preview()`, which for a video is
    // the poster blob.
    expect(media).not.toMatch(/<img[^>]*props\.media\.cid/);
  });

  it("reserves its space before the bytes arrive", () => {
    expect(media).toMatch(/aspect-ratio/);
    expect(media).toMatch(/function ratio\(m: MediaRef\): string/);
  });

  it("says how long the video is when the author's client measured it", () => {
    expect(media).toMatch(/duration_ms > 0/);
    expect(media).toMatch(/function clock\(ms: number\)/);
  });

  it("shows something rather than an empty box when there is no poster", () => {
    expect(media).toMatch(/<Film size=/);
  });
});

describe("the viewer plays by itself, and silently", () => {
  it("autoplays muted with controls", () => {
    expect(media).toMatch(/autoplay/);
    expect(media).toMatch(/muted=\{muted\(\)\}/);
    expect(media).toMatch(/playsinline/);
  });

  it("offers sound in one click, and remembers the answer", () => {
    expect(media).toMatch(/Sound off — click for sound/);
    expect(media).toMatch(/let soundOn = false/);
  });

  it("hands a format the webview cannot decode to a real player", () => {
    expect(media).toMatch(/Open in your player/);
    expect(flat(media)).toMatch(/cannot play that format/i);
    const rs = readFileSync(join(DESKTOP, "src-tauri", "src", "cmd_feed.rs"), "utf8");
    expect(rs).toMatch(/pub async fn feed_media_open/);
    // It takes a CID, not a path: the webview cannot name a file to open.
    expect(rs).toMatch(/It takes a CID, not a path/);
  });
});

describe("chat video", () => {
  it("draws its frame with a video element, since a sealed attachment has no poster", () => {
    expect(chats).toMatch(/preload="metadata"/);
    expect(flat(chats)).toMatch(/An <img> pointed at video bytes decodes nothing/);
  });

  it("starts silent, with sound one click away", () => {
    expect(chats).toMatch(/muted=\{muted\(\)\}/);
    expect(chats).toMatch(/Sound off — click for sound/);
  });
});
