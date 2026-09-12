// The reverse-username answer is `{"registrations":[...]}` as the gateway
// renders QueryReverseLookupResponse. Reading a top-level `name` (which is
// what this used to do) never found one, so no @username was ever shown
// next to an address anywhere in the app.
import { describe, expect, it } from "vitest";
import { usernameFromReverse } from "~/lib/people";

describe("usernameFromReverse", () => {
  it("reads the first non-empty name in registrations", () => {
    expect(
      usernameFromReverse({
        registrations: [
          { name: "", owner: "hash1a" },
          { name: "alice", owner: "hash1a", expiry_height: "7884000" },
        ],
      }),
    ).toBe("alice");
  });

  it("is undefined when there are no registrations", () => {
    expect(usernameFromReverse({ registrations: [] })).toBeUndefined();
    expect(usernameFromReverse({})).toBeUndefined();
    expect(usernameFromReverse(null)).toBeUndefined();
  });

  it("does not accept the shape that never occurs", () => {
    expect(usernameFromReverse({ name: "alice" })).toBeUndefined();
  });
});
