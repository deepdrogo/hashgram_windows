// Navigation for code that lives outside a route component (the store, event
// handlers, toast actions). Assigning `window.location.hash` also works with a
// HashRouter but goes through the browser history API and re-reads the URL;
// this keeps every jump inside Solid's router so no screen is torn down.
let router: ((to: string) => void) | null = null;
const queued: string[] = [];

/** Called once by the shell, which owns the router context. */
export function setNavigator(fn: (to: string) => void) {
  router = fn;
  while (queued.length) fn(queued.shift()!);
}

/** Navigates without reloading. Before the shell mounts the jump is queued. */
export function go(to: string) {
  if (router) router(to);
  else queued.push(to);
}
