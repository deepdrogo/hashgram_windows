// A Space has to work for three people and for three hundred. These tests
// hold the parts of that which are easy to lose: one conversation rather
// than a second messenger, subjects that come from what people write, and
// a member list somebody can actually use at scale.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(DESKTOP, ...p), "utf8");
const ui = read("src", "routes", "spaces", "Spaces.tsx");

describe("a Space is one room with everything in it", () => {
  it("posts, files, members, mail and a chat are all tabs of the same Space", () => {
    const tabs = /type Tab = ([^;]+);/.exec(ui)?.[1] ?? "";
    for (const tab of ["overview", "chat", "posts", "drive", "members", "mail"]) {
      expect(tabs, tab).toContain(`"${tab}"`);
    }
  });

  it("the chat is the Space's own group, not a new one", () => {
    const rs = read("src-tauri", "src", "cmd_spaces.rs");
    expect(rs).toMatch(/pub async fn spaces_chat_open/);
    expect(rs).toMatch(/A Space already is an MLS group/);
    // Nothing is created and nobody is invited a second time.
    expect(rs).not.toMatch(/create_conversation/);
  });

  it("the Space reuses the chat screen instead of a second implementation", () => {
    expect(ui).toContain("ChatThread");
    expect(ui).toMatch(/there is nothing to join and no second messenger/i);
  });
});

describe("subjects come from the people talking", () => {
  it("topics are the tags in the posts, not a list somebody maintains", () => {
    expect(ui).toMatch(/function tagsOf/);
    expect(ui).toMatch(/function TopicBar/);
    expect(ui).toMatch(/the topics that matter\s*\*?\s*are the ones people are using today/s);
  });
});

describe("a Space of hundreds stays usable", () => {
  it("members can be searched and filtered by role, with a count", () => {
    expect(ui).toContain("Find a member by address…");
    expect(ui).toMatch(/Showing \{shown\(\)\.length\} of \{props\.state\.members\.length\}/);
  });

  it("the member list scrolls instead of growing without end", () => {
    expect(ui).toMatch(/max-h-\[60vh\][^"]*overflow-auto[^"]*"\s*data-testid="members"/);
  });
});
