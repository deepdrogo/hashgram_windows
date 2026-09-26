// Fetching media before somebody asks for it.
//
// A story or a chat picture is a CID: the first time it is shown, the app
// has to find a provider, download it and decrypt it. Doing that when the
// user taps means the tap is followed by a wait, which is what made
// stories feel slow to open.
//
// So the app fetches quietly in the background instead — bounded, because
// the point is to be ready, not to saturate the link a live conversation
// is using.
import { ipc } from "./ipc";

/** Fetches in flight at once. Enough to be ready, few enough to stay polite. */
const PARALLEL = 3;

/** Jobs remembered as done, so nothing is fetched twice in a session. */
const done = new Set<string>();
const queue: (() => Promise<void>)[] = [];
let running = 0;

function pump() {
  while (running < PARALLEL && queue.length) {
    const job = queue.shift()!;
    running += 1;
    void job().finally(() => {
      running -= 1;
      pump();
    });
  }
}

function enqueue(id: string, job: () => Promise<void>) {
  if (done.has(id)) return;
  done.add(id);
  queue.push(job);
  pump();
}

/** Warms one piece of public media (a story frame, a post picture). */
export function prefetchMedia(cid: string, mime: string) {
  if (!cid) return;
  enqueue(`media:${cid}`, async () => {
    // The Rust side writes it to the cache folder and returns the same
    // path next time, so this is a fetch now instead of a fetch later.
    await ipc.feedMediaFetch(cid, mime).catch(() => undefined);
  });
}

/** Warms one chat attachment, which also decrypts it. */
export function prefetchAttachment(messageId: string, index: number) {
  enqueue(`attachment:${messageId}:${index}`, async () => {
    await ipc.chatAttachmentOpen(messageId, index).catch(() => undefined);
  });
}

/** Whether something has already been warmed this session. */
export function isWarm(id: string): boolean {
  return done.has(id);
}

/** Forgets what has been warmed. Called on lock, with the scratch folder. */
export function resetPrefetch() {
  done.clear();
  queue.length = 0;
}
