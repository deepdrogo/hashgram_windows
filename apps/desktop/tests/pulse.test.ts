// Pulse is the home screen and the only place social discovery happens.
// These tests hold the line on the two promises it makes: the feeds are
// transparent, and Local is a choice rather than a guess.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

const DESKTOP = join(__dirname, "..");
const SRC = join(DESKTOP, "src");
const read = (...p: string[]) => readFileSync(join(DESKTOP, ...p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([".ts", ".tsx"].includes(extname(p))) out.push(p);
  }
  return out;
}

/** Prose reflowed onto one line, so a wrapped sentence still matches. */
const flat = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/^\s*(\/\/|\*)\s?/, ""))
    .join(" ");
/** The file with its comments taken out. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Pulse", () => {
  const pulse = read("src", "routes", "pulse", "Pulse.tsx");

  it("offers exactly the feeds the product promises", () => {
    const tabs = [...pulse.matchAll(/\{ id: "(\w+)", label: "/g)].map((m) => m[1]);
    expect(tabs).toEqual(["latest", "following", "reels", "topics", "local"]);
  });

  it("each feed is chronological or set-filtered, never scored", () => {
    expect(code(pulse)).not.toMatch(/\brank(ing|ed)?\b|\bscore\b|recommend|algorithm/i);
  });

  it("Local filters on a country the user picked, not on the connection", () => {
    expect(pulse).toContain("local_country");
    expect(flat(pulse)).toMatch(/Nothing infers a location from an IP address/);
    for (const f of walk(SRC)) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/geoip|ipapi|ip-api|Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/i);
    }
  });
});

describe("one social home", () => {
  it("Explore is gone and its links land somewhere sensible", () => {
    expect(() => read("src", "routes", "Explore.tsx")).toThrow();
    const app = read("src", "App.tsx");
    expect(app).toContain('path="/explore/:section?/:arg?"');
    expect(app).toContain("ExploreRedirect");
  });

  it("holders and providers moved to Network, out of social discovery", () => {
    const rail = read("src", "components", "social", "DiscoveryRail.tsx");
    expect(rail).not.toMatch(/networkHolders|networkProviders/);
    expect(read("src", "routes", "Network.tsx")).toContain("<TopHolders />");
    expect(read("src", "routes", "Network.tsx")).toContain("<Providers />");
  });

  it("the old wall vocabulary is not what the user reads", () => {
    const shown = [read("src", "routes", "pulse", "Pulse.tsx"), read("src", "routes", "topics", "Topics.tsx")].join("\n");
    expect(shown).not.toMatch(/label: "Walls"|>Walls</);
  });
});

describe("search keeps private and public apart", () => {
  const palette = read("src", "components", "CommandPalette.tsx");

  it("says which half of the results left the machine", () => {
    expect(palette).toContain("the words never leave it");
  });

  it("private queries go only to local commands", () => {
    const privateCall = /ipc\.(mailSearch|driveSearch|peopleSearchLocal)\(/g;
    expect([...palette.matchAll(privateCall)].length).toBeGreaterThan(2);
    // The public half matches an already-received digest; it must not post
    // the typed words to an indexer.
    expect(palette).not.toMatch(/searchUsers|search\/hashtags|indexer\(/);
  });
});
