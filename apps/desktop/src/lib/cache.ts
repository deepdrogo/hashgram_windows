// What a screen already knew, so it can paint before the network answers.
//
// Every screen used to start empty and wait: opening Pulse, a profile or
// Earn meant a blank pane until a round trip finished, and on a slow link
// that reads as a frozen application. A screen now paints the last answer
// it had and replaces it when the fresh one arrives.
//
// Two rules make this safe rather than a source of stale lies:
//
//  * it is memory only. Nothing survives the process, so a cache can never
//    be older than this session and nothing sensitive reaches the disk;
//  * it is a first paint, never an answer. The fetch always runs, and what
//    it returns wins — so a deleted post, a removed file or a changed
//    avatar is gone the moment the real answer lands, not on some expiry.
import { createResource, type ResourceFetcher, type ResourceSource } from "solid-js";

const store = new Map<string, unknown>();

/** Remembers a value under `key`. */
export function remember<T>(key: string, value: T): T {
  store.set(key, value);
  return value;
}

/** The last value seen under `key`, if this session has seen one. */
export function recall<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

/** Forgets one key, or everything under a prefix when it ends in `*`. */
export function forget(key: string) {
  if (key.endsWith("*")) {
    const prefix = key.slice(0, -1);
    for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
    return;
  }
  store.delete(key);
}

/** Drops everything. Called when the vault locks or the account changes. */
export function forgetAll() {
  store.clear();
}

/**
 * A `createResource` that starts from what was last seen.
 *
 * `key(source)` names the cache entry, so a resource keyed on a route
 * parameter gets one entry per value rather than one shared entry.
 */
export function cachedResource<T, S>(
  source: ResourceSource<S>,
  key: (s: S) => string | null,
  fetcher: ResourceFetcher<S, T>,
) {
  let current: string | null = null;
  const wrapped: ResourceFetcher<S, T> = async (s, info) => {
    current = key(s);
    const value = await fetcher(s, info);
    if (current) remember(current, value);
    return value;
  };
  const [resource, actions] = createResource(source, wrapped);
  /** The fresh value, or the last one seen while it loads. */
  const withCache = (() => {
    const live = resource();
    if (live !== undefined) return live;
    return current ? recall<T>(current) : undefined;
  }) as CachedAccessor<T>;
  // `loading` and `error` stay properties, as they are on a Solid
  // resource, so a screen reads them the same way either way.
  Object.defineProperties(withCache, {
    loading: { get: () => resource.loading },
    error: { get: () => resource.error },
  });
  return [withCache, actions] as const;
}

/** A resource accessor that falls back to the last value seen. */
export interface CachedAccessor<T> {
  (): T | undefined;
  readonly loading: boolean;
  readonly error: unknown;
}
