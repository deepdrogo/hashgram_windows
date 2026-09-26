// Dark and light are both first-class. The bug this file exists to stop:
// the no-flash paint in index.html is unlayered, and an unlayered rule
// beats every rule inside a Tailwind @layer whatever the source order — so
// it silently painted the window black for anyone on the light theme and
// no token could override it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(DESKTOP, ...p), "utf8");

describe("the cold-start paint does not outrank the theme", () => {
  const html = read("index.html");

  it("it only applies before a theme has been chosen", () => {
    expect(html).toMatch(/html:not\(\[data-theme\]\)/);
    // No unconditional colour on html/body.
    expect(html).not.toMatch(/^\s*html, body \{ background: #000000/m);
  });

  it("the window advertises both schemes", () => {
    expect(html).toMatch(/content="dark light"/);
  });
});

describe("both themes are defined from the same roles", () => {
  const tokens = read("src", "styles", "tokens.css");

  it("every role has a light value", () => {
    const light = tokens.slice(tokens.indexOf('html[data-theme="light"]'));
    for (const role of ["--t-bg", "--t-surface", "--t-surface-2", "--t-border", "--t-accent", "--t-muted", "--t-fg", "--t-brand"]) {
      expect(light, role).toContain(`${role}:`);
    }
    expect(light).toContain("color-scheme: light");
  });

  it("the theme is reachable in one click, not only in Settings", () => {
    const shell = read("src", "components", "Shell.tsx");
    expect(shell).toContain("theme_switch_to_light");
    expect(shell).toContain("store.setTheme(");
  });

  it("the resolved theme is reactive, so the switch icon follows it", () => {
    const store = read("src", "lib", "store.ts");
    expect(store).toMatch(/setResolvedTheme\(resolved\)/);
    expect(store).toMatch(/resolvedTheme,/);
  });
});
