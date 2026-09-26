// Pictures and video in posts. The rules that matter here are about what
// travels and where the work happens: media is a reference, never a payload,
// and nothing is uploaded through a service in the middle.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(DESKTOP, ...p), "utf8");
const SDK = join(DESKTOP, "..", "..", "sdk", "rust", "hashgram-sdk", "src");
const sdk = (f: string) => readFileSync(join(SDK, f), "utf8");

describe("media is a reference, not a payload", () => {
  it("the composer sends paths and the Rust side reads the bytes", () => {
    const composer = read("src", "routes", "feed", "Feed.tsx");
    expect(composer).toContain("ipc.feedPostMedia(");
    // No file bytes are ever turned into a string in the webview; the one
    // thing that crosses as base64 is a poster frame a canvas produced.
    expect(composer).not.toMatch(/readAsDataURL|new FileReader|arrayBuffer\(\)/);
  });

  it("a post event carries a CID, a size and a poster, never the file", () => {
    const rs = read("src-tauri", "src", "cmd_feed.rs");
    expect(rs).toMatch(/the post never carries the bytes/);
    expect(rs).toContain("upload_media_with(");
  });
});

describe("public media is replicated like the network expects", () => {
  it("uploads target the same count the node repairs towards", () => {
    expect(sdk("blob.rs")).toMatch(/pub const PUBLIC_REPLICAS: usize = 3/);
    expect(sdk("feed.rs")).toContain("crate::blob::PUBLIC_REPLICAS");
    const node = readFileSync(join(DESKTOP, "..", "..", "node", "hashgram-node", "src", "blob.rs"), "utf8");
    const target = /TARGET_REPLICAS: u32 = (\d+)/.exec(node)?.[1];
    expect(target).toBe("3");
  });
});

describe("no transcoder, no upload service", () => {
  it("the desktop decodes pictures but never video", () => {
    const cargo = read("src-tauri", "Cargo.toml");
    expect(cargo).toMatch(/^image = /m);
    expect(cargo).not.toMatch(/ffmpeg|gstreamer|libav/i);
  });

  it("a video's poster comes from the webview and is re-encoded here", () => {
    const rs = read("src-tauri", "src", "media.rs");
    expect(rs).toContain("no transcoder ships with the app");
    // Whatever arrives is decoded and re-encoded before it is stored.
    expect(rs).toMatch(/fn poster\(/);
    expect(rs).toContain("image::load_from_memory(&bytes).ok()?");
  });

  it("nothing posts media to an http endpoint", () => {
    const meta = read("src", "lib", "mediameta.ts");
    expect(meta).not.toMatch(/fetch\(|XMLHttpRequest|http/);
  });
});

describe("feeds stay cheap to scroll", () => {
  it("tiles load only when they are near the viewport", () => {
    const media = read("src", "components", "social", "Media.tsx");
    expect(media).toContain("IntersectionObserver");
    expect(media).toContain('rootMargin: "300px"');
    expect(media).toContain('loading="lazy"');
  });
});
