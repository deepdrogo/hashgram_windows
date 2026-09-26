// Per-screen UI state that has to outlive a route component: scroll offsets,
// the tab a screen was left on, an unsent composer draft. Solid unmounts a
// route when you leave it, so this module-level cache is what makes coming
// back feel like returning rather than starting over.
//
// Nothing here is persisted to disk and everything textual is dropped on lock,
// because a draft is user content and the lock screen must not keep it around.

const scrolls = new Map<string, number>();
const tabs = new Map<string, string>();
const drafts = new Map<string, string>();

export function rememberScroll(key: string, top: number) {
  scrolls.set(key, top);
}

export function recallScroll(key: string): number {
  return scrolls.get(key) ?? 0;
}

/** Restores the scroll offset once the element has its content. */
export function restoreScroll(key: string, el: HTMLElement | undefined | null) {
  const top = scrolls.get(key);
  if (!el || !top) return;
  requestAnimationFrame(() => {
    el.scrollTop = top;
  });
}

/** Tracks an element's scroll offset for the lifetime of the screen. */
export function trackScroll(key: string, el: HTMLElement) {
  restoreScroll(key, el);
  const onScroll = () => rememberScroll(key, el.scrollTop);
  el.addEventListener("scroll", onScroll, { passive: true });
  return () => el.removeEventListener("scroll", onScroll);
}

export function rememberTab(key: string, tab: string) {
  tabs.set(key, tab);
}

export function recallTab(key: string, fallback: string): string {
  return tabs.get(key) ?? fallback;
}

export function rememberDraft(key: string, text: string) {
  if (text) drafts.set(key, text);
  else drafts.delete(key);
}

export function recallDraft(key: string): string {
  return drafts.get(key) ?? "";
}

/** Called on lock: positions are harmless, text the user typed is not. */
export function clearOnLock() {
  drafts.clear();
}

/** Called on sign-out and when a different identity is unlocked. */
export function clearAll() {
  scrolls.clear();
  tabs.clear();
  drafts.clear();
}
