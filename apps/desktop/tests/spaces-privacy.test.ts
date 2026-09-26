// A closed Space is closed in the code, not in the copy.
//
// The dangerous change is a small one: somebody adds a Space feature, needs
// it to reach people who are not in the group, and reaches for the public
// event layer because it is right there and it works. Nothing in the UI
// would look different, and the Space would quietly stop being private.
//
// These tests pin the boundary. Space content has exactly one way out — the
// group's own encrypted messages — and the only public thing a Space may
// emit is the directory listing, which carries no content at all.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = join(__dirname, "..");
const SDK = join(__dirname, "..", "..", "..", "sdk", "rust", "hashgram-sdk", "src");
const read = (...p: string[]) => readFileSync(join(DESKTOP, ...p), "utf8");
// Comment markers first (longest first, or `///` leaves a stray slash),
// then the wrapping, so a sentence can be matched as a sentence.
const flat = (s: string) => s.replace(/^[ \t]*(\/\/\/|\/\/!|\/\/)[ \t]?/gm, "").replace(/\s+/g, " ");
/** Code with the prose taken out, for "this must not appear" checks. */
const code = (s: string) => s.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\s+/g, " ");

const rs = read("src-tauri", "src", "cmd_spaces.rs");
const sdk = readFileSync(join(SDK, "spaces.rs"), "utf8");
/** The body of one command, prose removed and wrapping flattened. */
const fnBody = (src: string, name: string) => {
  const start = src.indexOf(`pub async fn ${name}`);
  const next = src.indexOf("#[tauri::command]", start);
  return code(src.slice(start, next === -1 ? undefined : next));
};

describe("Space content leaves the device only inside the group", () => {
  it("every Space event is sent as a group message", () => {
    // `send_app` wraps the event and hands it to `messaging::send`, which is
    // the MLS path. There is no other sender in this module.
    const sends = [...sdk.matchAll(/\.\s*send_app\(/g)].length;
    expect(sends).toBeGreaterThan(0);
    expect(sdk).not.toMatch(/\.social\(\)/);
    expect(sdk).not.toMatch(/EventPublish|publish_event|feed\(\)/);
  });

  it("the commands never put Space content on the public event layer", () => {
    // `feed()` appears twice on purpose: creating the listing, and reading
    // the directory. Both are about the listing, never about content.
    const uses = [...rs.matchAll(/one\.feed\(\)\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(uses)).toEqual(new Set(["create_wall", "digest"]));
  });

  it("posting, announcing, commenting and sharing a file go through the Space API only", () => {
    for (const cmd of ["spaces_post", "spaces_announce", "spaces_comment", "spaces_share_drive", "spaces_mail"]) {
      const body = fnBody(rs, cmd);
      expect(body, cmd).toMatch(/one \.spaces\(\)|one\.spaces\(\)/);
      expect(body, cmd).not.toMatch(/feed\(\)|upload_media|publish/);
    }
  });
});

describe("listing a Space says it exists, and nothing else", () => {
  it("the listing carries no member, message, file or count", () => {
    const body = fnBody(rs, "spaces_publish");
    expect(body).toMatch(/create_wall\(&summary\.name, &body, false\)/);
    expect(body).not.toMatch(/\.members\(|\.content\(|drive_entries/);
  });

  it("only the Owner may publish one", () => {
    expect(rs).toMatch(/only the Owner may list a Space publicly/);
    expect(rs).toMatch(/my_role != app::SpaceRole::Owner as i32/);
  });

  it("it cannot be published twice", () => {
    expect(rs).toMatch(/that Space is already listed/);
  });

  it("the code states that findable is not readable", () => {
    expect(flat(rs)).toMatch(/being findable and being readable are different things/i);
  });

  it("the space id in a listing is documented as not a capability", () => {
    expect(flat(rs)).toMatch(/nothing in the protocol grants access by id/i);
  });
});

describe("the UI does not let 'public' be misread", () => {
  const panel = read("src", "routes", "spaces", "Discover.tsx");

  it("an unlisted Space says nobody outside knows it exists", () => {
    expect(flat(panel)).toMatch(/nobody outside knows it exists/i);
  });

  it("a listed Space says the members and content are still members-only", () => {
    expect(flat(panel)).toMatch(/Listed, and still closed/);
    expect(flat(panel)).toMatch(/readable only by members/i);
  });

  it("it warns before publishing, and says it cannot be taken back", () => {
    expect(flat(panel)).toMatch(/cannot be taken back/i);
    expect(flat(panel)).toMatch(/Ask the members first/i);
  });

  it("the directory never suggests an outsider can walk in", () => {
    expect(flat(panel)).toMatch(/A listing is public; the Space is not/);
    expect(panel).not.toMatch(/\bJoin now\b|\bOpen Space\b/);
  });
});
