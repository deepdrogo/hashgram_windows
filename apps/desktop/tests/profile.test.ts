// A profile is a projection of signed events. These tests guard the two
// things that are easy to get wrong when a social screen has empty space to
// fill: inventing a number, and inferring something the user did not say.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(DESKTOP, ...p), "utf8");
const SDK = join(DESKTOP, "..", "..", "sdk", "rust", "hashgram-sdk", "src");

describe("profile counts are honest", () => {
  it("followers is optional all the way through, because no chain records them", () => {
    expect(readFileSync(join(SDK, "feed.rs"), "utf8")).toMatch(/pub followers: Option<u32>/);
    expect(read("src-tauri", "src", "views.rs")).toMatch(/pub followers: Option<u32>/);
    expect(read("src", "lib", "ipc.ts")).toMatch(/followers: number \| null/);
  });

  it("the screen shows 'unknown' rather than a zero it cannot stand behind", () => {
    const screen = read("src", "routes", "profile", "Profile.tsx");
    expect(screen).toContain("stats.followers !== null");
    expect(screen).toMatch(/Followers.*unknown/s);
  });

  it("counts say where they came from", () => {
    expect(read("src-tauri", "src", "cmd_profile.rs")).toMatch(/source = "indexer"/);
    expect(read("src", "routes", "profile", "Profile.tsx")).toContain('stats.source !== "indexer"');
  });
});

describe("profile country is declared, never inferred", () => {
  it("the SDK writes only what the user typed", () => {
    const feed = readFileSync(join(SDK, "feed.rs"), "utf8");
    expect(feed).toContain("ATTR_COUNTRY");
    expect(feed).toMatch(/never inferred from an address or a connection/);
  });

  it("nothing reads a location from the network", () => {
    const rs = read("src-tauri", "src", "cmd_profile.rs");
    expect(rs).not.toMatch(/geoip|geo_ip|ip2|locale\(\)|timezone/i);
  });
});

describe("profile editing", () => {
  it("the editor tells the user the fields are public", () => {
    const editor = read("src", "routes", "profile", "ProfileEdit.tsx");
    expect(editor).toContain("This is public");
  });

  it("a website must be an http(s) address and the country a two-letter code", () => {
    const rs = read("src-tauri", "src", "cmd_profile.rs");
    expect(rs).toContain("the website must start with https://");
    expect(rs).toContain("the country is a two-letter code, or empty");
  });
});

describe("profile timeline", () => {
  it("every tab the UI offers is a tab the SDK knows", () => {
    const screen = read("src", "routes", "profile", "Profile.tsx");
    const tabs = [...screen.matchAll(/\{ id: "(\w+)", label: "/g)].map((m) => m[1]);
    expect(tabs).toEqual(["posts", "replies", "media", "likes"]);
    const feed = readFileSync(join(SDK, "feed.rs"), "utf8");
    for (const t of tabs) expect(feed, t).toContain(`"${t}" => Some(Self::`);
  });

  it("Media is a view over posts, not a second store of media", () => {
    const screen = read("src", "routes", "profile", "Profile.tsx");
    expect(screen).toContain("never a separate library");
    expect(screen).not.toMatch(/ipc\.\w*mediaList|media_library/);
  });
});
