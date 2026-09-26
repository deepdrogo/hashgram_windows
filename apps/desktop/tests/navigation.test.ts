// Navigation must never reload the WebView. A desktop window that flashes
// white and starts over on every click is the bug this file exists to stop.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative, sep } from "node:path";

const DESKTOP = join(__dirname, "..");
const SRC = join(DESKTOP, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([".ts", ".tsx"].includes(extname(p))) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const rel = (f: string) => relative(DESKTOP, f).split(sep).join("/");
const read = (f: string) => readFileSync(f, "utf8");

// A reload is legitimate in exactly three places, and each of them has just
// destroyed the vault the window was built around.
const MAY_RELOAD = new Set(["src/App.tsx", "src/components/Shell.tsx", "src/routes/Settings.tsx"]);

describe("no full page reloads", () => {
  it("only the three restart-after-wipe paths call location.reload()", () => {
    const hits = files.filter((f) => /location\.reload\(/.test(read(f))).map(rel);
    expect(hits.filter((h) => !MAY_RELOAD.has(h))).toEqual([]);
  });

  it("nothing navigates by assigning a URL", () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = read(f);
      if (/location\.href\s*=|location\.assign\(|location\.replace\(/.test(text)) hits.push(rel(f));
      // `lib/nav.ts` documents the hash approach in prose; nobody may use it.
      if (rel(f) !== "src/lib/nav.ts" && /location\.hash\s*=/.test(text)) hits.push(rel(f));
    }
    expect(hits).toEqual([]);
  });

  it("internal links go through the router, never a bare anchor", () => {
    const hits: string[] = [];
    for (const f of files) {
      for (const m of read(f).matchAll(/<a\s[^>]*href=["'{]\/(?!\/)/g)) hits.push(`${rel(f)}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });

  it("no form submits the document", () => {
    const hits = files.filter((f) => /<form(\s|>)/.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });
});

describe("routing", () => {
  const app = read(join(SRC, "App.tsx"));

  it("Pulse is the screen the app opens on", () => {
    expect(app).toMatch(/path="\/"\s+component=\{\(\) => <Navigate href="\/pulse"/);
    expect(app).toMatch(/path="\*"\s+component=\{\(\) => <Navigate href="\/pulse"/);
  });

  it("the sections a released build already linked to still resolve", () => {
    for (const legacy of ["/hashwall/:tab?/:id?", "/feed/:tab?/:id?", "/people/:address?", "/me"]) {
      expect(app, legacy).toContain(`path="${legacy}"`);
    }
  });

  it("every rail destination the user can see has a route", () => {
    const shell = read(join(SRC, "components", "Shell.tsx"));
    const targets = [...shell.matchAll(/\{\s*to:\s*"([^"]+)"[^}]*\}/g)]
      .filter((m) => !m[0].includes("enabled: false"))
      .map((m) => m[1]!);
    const routes = [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]!.replace(/\/:.*$/, ""));
    const missing = targets.filter((to) => !routes.some((r) => to === r || to.startsWith(`${r}/`)));
    expect(missing).toEqual([]);
  });
});

describe("state survives leaving a screen", () => {
  it("the UI state cache drops typed text on lock and keeps positions", () => {
    const ui = read(join(SRC, "lib", "uistate.ts"));
    expect(ui).toMatch(/export function clearOnLock\(\)/);
    expect(ui).toMatch(/drafts\.clear\(\)/);
    const store = read(join(SRC, "lib", "store.ts"));
    expect(store).toContain("clearOnLock()");
  });
});
