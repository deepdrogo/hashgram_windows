// Stories: a row of faces at the top of Pulse, and the viewer behind them.
//
// What "24 hours" means here is written down in docs/STORIES.md and it is
// not deletion. After the expiry an author signed, this app stops showing
// the story and indexes stop serving it. Nothing in this file, and nothing
// in the strings it renders, promises that the bytes left the machines that
// already had them.
import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { useNavigate } from "@solidjs/router";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Plus, X, ChevronLeft, ChevronRight, Pause, Play } from "lucide-solid";
import { Button, Dialog, Field, Input, Notice, Select, Checkbox } from "~/components/ui";
import { Avatar, Who, avatarSrc } from "~/components/identity";
import { ipc, errText, type Story } from "~/lib/ipc";
import { store } from "~/lib/store";
import { cachedResource } from "~/lib/cache";
import { prefetchMedia } from "~/lib/prefetch";
import { measureVideo } from "~/lib/mediameta";
import { pickFile } from "~/lib/dialogs";

/** How long one story is shown before the viewer moves on. */
const STEP_MS = 5000;

/** A caption is a line under a picture. Longer belongs in a post. */
const CAPTION_MAX = 200;

export function StoriesRow() {
  const [compose, setCompose] = createSignal(false);
  const [viewing, setViewing] = createSignal<string | null>(null);
  const [stories, { refetch }] = cachedResource(
    () => ({ tick: store.ticks().feed, locked: store.locked() }),
    (k) => (k.locked ? null : "stories:active"),
    (k) => (k.locked ? Promise.resolve([] as Story[]) : ipc.storiesActive().catch(() => [] as Story[])),
  );

  // Warm every story's first frame as soon as the row knows about it, so
  // opening one is instant rather than a wait on a provider lookup.
  createEffect(() => {
    for (const s of stories() ?? []) {
      const first = s.media[0];
      if (!first) continue;
      // The poster is what the viewer paints first for a video, so warm
      // that rather than pulling megabytes nobody has asked to watch.
      if (first.poster_cid) prefetchMedia(first.poster_cid, "image/jpeg");
      else prefetchMedia(first.cid, first.mime);
    }
  });

  // One bubble per author, newest first, with our own always first.
  const me = () => store.status()?.address ?? "";
  const authors = createMemo(() => {
    const seen = new Map<string, number>();
    for (const s of stories() ?? []) seen.set(s.author, Math.max(seen.get(s.author) ?? 0, s.created_at));
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  });
  const mine = () => !!me() && authors().includes(me());

  return (
    <div class="mb-3 flex gap-3 overflow-x-auto pb-1">
      <Bubble label={mine() ? "Your story" : "Add story"} onClick={() => setCompose(true)}>
        <span class="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-border text-muted">
          <Plus size={18} />
        </span>
      </Bubble>
      <Show when={mine()}>
        <Bubble label="You" onClick={() => setViewing(me())}>
          <StoryAvatar address={me()} />
        </Bubble>
      </Show>
      <For each={authors().filter((a) => a !== me())}>
        {(address) => (
          <Bubble label={<Who address={address} size="sm" />} onClick={() => setViewing(address)}>
            <StoryAvatar address={address} />
          </Bubble>
        )}
      </For>

      <Show when={viewing()}>
        {(address) => <StoryViewer address={address()} onClose={() => setViewing(null)} />}
      </Show>
      <StoryComposer open={compose()} onClose={() => setCompose(false)} onPosted={() => void refetch()} />
    </div>
  );
}

function Bubble(props: { label: unknown; onClick: () => void; children: unknown }) {
  return (
    <button type="button" class="flex w-16 shrink-0 flex-col items-center gap-1" onClick={props.onClick}>
      {props.children as never}
      <span class="w-full truncate text-center text-[11px] text-muted">{props.label as never}</span>
    </button>
  );
}

function StoryAvatar(props: { address: string }) {
  const [src] = createResource(() => props.address, avatarSrc);
  return (
    // The ring is a circle, so what it frames has to be one too. The picture
    // is clipped to the same shape and cropped to fill it, rather than laid
    // inside the ring with its corners showing.
    <span class="block rounded-full p-[3px] ring-2 ring-brand">
      <span class="block h-[52px] w-[52px] overflow-hidden rounded-full">
        <Avatar address={props.address} size={52} src={src() ?? null} round />
      </span>
    </span>
  );
}

/** Fullscreen viewer: one author's stories, oldest first. */
function StoryViewer(props: { address: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [index, setIndex] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [items] = createResource(
    () => props.address,
    (a) => ipc.storiesOf(a).catch(() => [] as Story[]),
  );
  const current = () => items()?.[index()];
  const first = () => current()?.media[0] ?? null;
  const [src] = createResource(first, async (m) => {
    try {
      return convertFileSrc(await ipc.feedMediaFetch(m.cid, m.mime));
    } catch {
      return null;
    }
  });
  // A story's video can be several megabytes; its poster is a few kilobytes
  // and holds the frame while the rest arrives.
  const [poster] = createResource(
    () => first()?.poster_cid || null,
    async (cid) => {
      try {
        return convertFileSrc(await ipc.feedMediaFetch(cid, "image/jpeg"));
      } catch {
        return null;
      }
    },
  );

  const step = (d: number) => {
    const n = items()?.length ?? 0;
    const next = index() + d;
    if (next < 0 || next >= n) props.onClose();
    else setIndex(next);
  };

  onMount(() => {
    const timer = setInterval(() => {
      if (!paused() && items()?.length) step(1);
    }, STEP_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      clearInterval(timer);
      window.removeEventListener("keydown", onKey);
    });
  });

  const left = () => {
    const c = current();
    if (!c) return "";
    const hours = Math.max(0, Math.round((c.expires_at - Date.now() / 1000) / 3600));
    return hours >= 1 ? `${hours} h left` : "less than an hour left";
  };

  return (
    <Portal>
      <div class="fixed inset-0 z-50 flex flex-col bg-bg/95" role="dialog" aria-label="Story">
        <div class="flex items-center gap-2 px-4 pt-3">
          <For each={items() ?? []}>
            {(_, i) => <span class={`h-0.5 flex-1 rounded-full ${i() <= index() ? "bg-fg" : "bg-surface-2"}`} />}
          </For>
        </div>
        <div class="flex items-center gap-3 px-4 py-2">
          <button type="button" class="flex items-center gap-2" onClick={() => { props.onClose(); navigate(`/profile/${props.address}`); }}>
            <StoryAvatar address={props.address} />
            <Who address={props.address} size="sm" />
          </button>
          <span class="text-xs text-muted" title="Set by the author when they posted it">
            {left()}
          </span>
          <span class="flex-1" />
          <button type="button" class="btn-ghost btn-icon-sm" aria-label={paused() ? "Play" : "Pause"} onClick={() => setPaused((p) => !p)}>
            {paused() ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button type="button" class="btn-ghost btn-icon-sm" aria-label="Close" onClick={props.onClose}>
            <X size={16} />
          </button>
        </div>
        <div class="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4">
          <button type="button" class="absolute left-3 btn-ghost btn-icon-sm" aria-label="Previous" onClick={() => step(-1)}>
            <ChevronLeft size={18} />
          </button>
          <Show when={current()} fallback={<p class="text-sm text-muted">No story to show.</p>}>
            {(c) => (
              <div class="flex max-h-full flex-col items-center gap-2">
                <Show
                  when={src()}
                  fallback={
                    <Show when={poster()} fallback={<p class="text-sm text-muted">Fetching from the network…</p>}>
                      <img src={poster() ?? ""} alt="" class="max-h-[72vh] rounded-md object-contain opacity-60" />
                    </Show>
                  }
                >
                  <Show when={c().media[0]!.mime.startsWith("video/")} fallback={<img src={src() ?? ""} alt="" class="max-h-[72vh] rounded-md object-contain" />}>
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <video src={src() ?? ""} poster={poster() ?? undefined} class="max-h-[72vh] rounded-md" autoplay controls={false} muted playsinline onEnded={() => step(1)} />
                  </Show>
                </Show>
                <Show when={c().caption}>
                  <p class="max-w-xl text-center text-sm selectable">{c().caption}</p>
                </Show>
              </div>
            )}
          </Show>
          <button type="button" class="absolute right-3 btn-ghost btn-icon-sm" aria-label="Next" onClick={() => step(1)}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </Portal>
  );
}

function StoryComposer(props: { open: boolean; onClose: () => void; onPosted: () => void }) {
  const [path, setPath] = createSignal("");
  const [caption, setCaption] = createSignal("");
  const [hours, setHours] = createSignal("24");
  const [sensitive, setSensitive] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const pick = async () => {
    const [p] = await pickFile({ filters: [{ name: "Picture or video", extensions: ["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm"] }] });
    if (p) setPath(p);
  };

  const post = async () => {
    if (!path()) return;
    setBusy(true);
    setError(null);
    try {
      const client = await measureVideo(path());
      await ipc.storyCreate(caption(), { path: path(), client }, Number(hours()), sensitive());
      store.toast("Story posted");
      store.bump("feed");
      setPath("");
      setCaption("");
      props.onPosted();
      props.onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} title="Add to your story">
      <div class="flex flex-col gap-3">
        <Notice title="What expiry means here">
          After the time you choose, Pulse and profiles stop showing this story and indexes stop serving it. It is not deleted from machines that already hold it — nothing public on a peer-to-peer network can be.
        </Notice>
        <div class="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => void pick()}>
            Choose a picture or video
          </Button>
          <span class="truncate text-xs text-muted">{path().split(/[\\/]/).pop()}</span>
        </div>
        <p class="text-[11px] text-muted">A story is a picture or a video. Text on its own is a post.</p>
        <Field label="Caption" hint={`A line under it — ${CAPTION_MAX - caption().length} characters left.`}>
          <Input value={caption()} maxLength={CAPTION_MAX} onInput={(e) => setCaption(e.currentTarget.value)} />
        </Field>
        <Field label="Show it for" hint="The protocol refuses anything over 48 hours.">
          <Select
            class="w-40"
            value={hours()}
            onChange={setHours}
            options={[
              { value: "6", label: "6 hours" },
              { value: "12", label: "12 hours" },
              { value: "24", label: "24 hours" },
              { value: "48", label: "48 hours" },
            ]}
          />
        </Field>
        <Checkbox checked={sensitive()} onChange={setSensitive} label="Sensitive" hint="Viewers click before it shows." />
        <Show when={error()}>
          <Notice strong>{error()}</Notice>
        </Show>
        <div class="flex justify-end">
          <Button loading={busy()} disabled={!path()} onClick={() => void post()}>
            Post story
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
