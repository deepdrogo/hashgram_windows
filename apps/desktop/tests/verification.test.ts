// The verified badge is evidence, not permission.
//
// These tests exist because a badge is exactly the kind of feature that
// rots into a lie: someone adds a "verified" boolean to make the UI easier,
// and from then on the tick means "this app decided to draw a tick". The
// rules below keep the badge tied to a payment anyone can check.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
// Prose is wrapped and prefixed with comment markers, so a sentence is
// matched after the markers and the line breaks are taken back out. Longest
// marker first, or `///` would leave a stray slash mid-sentence.
const flat = (s: string) => s.replace(/^[ \t]*(\/\/\/|\/\/!|\/\/)[ \t]?/gm, "").replace(/\s+/g, " ");

describe("the badge is drawn from a chain check, not a profile field", () => {
  const badge = read("src", "components", "social", "Verified.tsx");

  it("it renders only when the check passed", () => {
    expect(badge).toMatch(/verified === true/);
  });

  it("it never reads a bare profile attribute to decide", () => {
    expect(badge).not.toMatch(/profile\(\)\.verified/);
    expect(badge).not.toMatch(/p\(\)\.verify_tx\s*\?/);
  });

  it("the tooltip states what the badge does not prove", () => {
    expect(flat(badge)).toMatch(/not who the person is/i);
  });
});

describe("the price and the destination", () => {
  const rs = read("src-tauri", "src", "cmd_verify.rs");

  it("the price is one hundred thousand HASH, in uhash", () => {
    expect(rs).toMatch(/PRICE_UHASH: u128 = 100_000 \* UHASH_PER_HASH/);
  });

  it("the destination is derived and then confirmed, never hard-coded", () => {
    expect(rs).not.toMatch(/"hash1[0-9a-z]{10,}"/);
    // Derived from the module's name — a pure function anyone can repeat…
    expect(rs).toMatch(/module_address\(SINK_MODULE\)/);
    // …and then checked against what the chain says lives there.
    expect(rs).toMatch(/cosmos\/auth\/v1beta1\/accounts\//);
    expect(rs).toMatch(/is_module && is_gov && text\.contains\(&derived\)/);
  });

  it("an unconfirmed destination means no payment, and says why", () => {
    expect(flat(rs)).toMatch(/Refusing to sell a badge is a much smaller failure/);
    const panel = read("src", "routes", "profile", "Verification.tsx");
    expect(flat(panel)).toMatch(/could not confirm the destination, so the app will not send anything/);
  });

  it("the money does not go to the founder or to us", () => {
    expect(flat(rs)).toMatch(/not paid to the founder/i);
  });

  it("a failed transaction is not a pass, and a missing one is not a badge either", () => {
    expect(rs).toMatch(/that transaction failed on chain/);
    // Missing means pending, and pending draws nothing.
    expect(rs).toMatch(/out\.pending = true/);
    const badge = read("src", "components", "social", "Verified.tsx");
    expect(badge).toMatch(/verified === true/);
  });

  it("paying and claiming are separate, so a payment is never lost", () => {
    expect(rs).toMatch(/pub async fn verify_record/);
    expect(flat(rs)).toMatch(/the money is never lost/i);
  });

  it("a profile edit carries the claim forward rather than re-earning it", () => {
    const profile = read("src-tauri", "src", "cmd_profile.rs");
    expect(flat(profile)).toMatch(/carry the verification claim forward/i);
  });
});

describe("a payment that is not in a block yet", () => {
  const rs = read("src-tauri", "src", "cmd_verify.rs");
  const panel = read("src", "routes", "profile", "Verification.tsx");

  it("is pending, not refused", () => {
    expect(rs).toMatch(/pub pending: bool/);
    expect(rs).toMatch(/waiting for the payment to be included in a block/);
    expect(flat(rs)).toMatch(/Not a failure and not a badge/);
  });

  it("keeps checking instead of leaving a paid account looking rejected", () => {
    expect(panel).toMatch(/const watchForBlock/);
    expect(flat(panel)).toMatch(/the worst moment to look broken/);
  });

  it("the fee is counted before the money moves", () => {
    expect(rs).toMatch(/preview_send\(&dest, PRICE_UHASH\)/);
    expect(flat(rs)).toMatch(/The fee is paid on top of the price/);
  });

  it("the destination is confirmed two independent ways", () => {
    expect(rs).toMatch(/Route one: ask what lives at the derived address/);
    expect(rs).toMatch(/Route two: ask the chain for the module account by name/);
    expect(flat(rs)).toMatch(/a disagreement means something is wrong and nothing is sent/i);
  });
});

describe("the purchase asks before it spends", () => {
  const panel = read("src", "routes", "profile", "Verification.tsx");

  it("it needs a typed confirmation", () => {
    expect(panel).toMatch(/VERIFY/);
    expect(panel).toMatch(/confirm\(\).trim\(\) !== "VERIFY"/);
  });

  it("it says the payment cannot be reversed", () => {
    expect(flat(panel)).toMatch(/cannot be reversed/i);
  });

  it("a claim that failed its check is shown as no badge, with the reason", () => {
    expect(flat(panel)).toMatch(/did not check out/i);
    expect(flat(panel)).toMatch(/No badge is shown/i);
  });
});
