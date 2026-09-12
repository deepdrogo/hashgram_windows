// Who is who: verified @username (chain) and self-declared display name
// (latest signed PROFILE_UPDATE), cached per address for the session.
import { createSignal } from "solid-js";
import { ipc, pick, str } from "./ipc";
import type { Person } from "~/components/identity";

const cache = new Map<string, Person>();
const [version, setVersion] = createSignal(0);
const pending = new Set<string>();
/** Addresses whose chain lookup failed (no source yet), with when; retried after a pause. */
const failedAt = new Map<string, number>();
const RETRY_MS = 30_000;

/**
 * The `@username` in a `hashgram/username/v1/reverse/{owner}` answer.
 * The gateway renders it as `{"registrations":[{"name":..,"owner":..}]}`;
 * there is no top-level `name`.
 */
export function usernameFromReverse(value: unknown): string | undefined {
  const regs = pick(value, "registrations");
  if (!Array.isArray(regs)) return undefined;
  for (const r of regs) {
    const name = str(pick(r, "name"));
    if (name) return name;
  }
  return undefined;
}

/** Reactive lookup; kicks off resolution the first time. */
export function person(address: string): Person {
  version();
  const hit = cache.get(address);
  if (hit) return hit;
  const failed = failedAt.get(address);
  if (failed !== undefined && Date.now() - failed < RETRY_MS) return { address };
  if (!pending.has(address)) {
    pending.add(address);
    void resolve(address);
  }
  return { address };
}

async function resolve(address: string) {
  const p: Person = { address };
  let chainAnswered = false;
  try {
    const r = await ipc.chainGet(`hashgram/username/v1/reverse/${address}`);
    chainAnswered = true;
    const name = usernameFromReverse(r.value);
    if (name) p.username = name;
  } catch {
    /* no chain source yet: remembered below so it is retried, not cached */
  }
  try {
    const prof = await ipc.profileGet(address, false);
    const dn = str(pick(prof.profile, "display_name"));
    if (dn) p.displayName = dn;
  } catch {
    /* no profile */
  }
  if (chainAnswered) {
    cache.set(address, p);
    failedAt.delete(address);
  } else {
    // Show what we have, but ask the chain again later: caching a miss
    // caused by "no node yet" hid usernames for the whole session.
    failedAt.set(address, Date.now());
  }
  pending.delete(address);
  setVersion((v) => v + 1);
}

/** Forgets one address (after a profile update). */
export function forget(address: string) {
  cache.delete(address);
  setVersion((v) => v + 1);
}
