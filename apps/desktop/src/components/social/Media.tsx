// Showing pictures and video in a feed.
//
// A post carries a CID, not bytes, so every tile is a fetch. Two rules keep
// that from hurting: nothing loads until it is near the viewport, and when
// the author attached a poster the poster is what loads first. Opening a
// tile is what pulls the full picture or starts the video.
import { For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { convertFileSrc } from "@tauri-apps/api/core";
import { X, ChevronLeft, ChevronRight, Play } from "lucide-solid";
import { ipc, type FeedItem } from "~/lib/ipc";

export interface MediaRef {
  cid: string;
  mime: string;
  size: number;
}

/** The media attached to one post, as the card shows it. */
export function MediaStrip(props: { item: FeedItem; sensitive?: boolean }) {
  const [open, setOpen] = createSignal<number | null>(null);
  const media = (): MediaRef[] => props.item.media.map(([cid, mime, size]) => ({ cid, mime, size }));
  const cols = () => (media().length === 1 ? "grid-cols-1" : media().length === 2 ? "grid-cols-2" : "grid-cols-3");
  return (
    <Show when={media().length}>
      <div class={`mt-2 grid gap-1 ${cols()}`}>
        <For each={media()}>
          {(m, i) => <Tile media={m} blurred={props.sensitive} tall={media().length === 1} onOpen={() => setOpen(i())} />}
        </For>
      </div>
      <Show when={open() !== null}>
        <Lightbox media={media()} index={open()!} onIndex={setOpen} onClose={() => setOpen(null)} />
      </Show>
    </Show>
  );
}

/** Loads a CID only once the tile is close to being seen. */
function useNearby() {
  const [near, setNear] = createSignal(false);
  const watch = (el: HTMLElement) => {
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          obs.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(el);
    onCleanup(() => obs.disconnect());
  };
  return { near, watch };
}

/** One square tile, for a grid that is a view over posts. */
export function MediaTile(props: { media: MediaRef; onOpen: () => void }) {
  return <Tile media={props.media} onOpen={props.onOpen} />;
}

function Tile(props: { media: MediaRef; blurred?: boolean; tall?: boolean; onOpen: () => void }) {
  const { near, watch } = useNearby();
  const [src] = createResource(
    () => (near() ? props.media.cid : null),
    async (cid) => {
      try {
        return convertFileSrc(await ipc.feedMediaFetch(cid, props.media.mime));
      } catch {
        return null;
      }
    },
  );
  const video = () => props.media.mime.startsWith("video/");
  return (
    <button
      type="button"
      ref={watch}
      class={`relative overflow-hidden rounded-md border border-border bg-surface-2 ${props.tall ? "max-h-[420px]" : "aspect-square"}`}
      onClick={props.onOpen}
      title={video() ? "Play" : "Open"}
    >
      <Show when={src()} fallback={<span class="block h-full min-h-32 w-full" />}>
        <img
          src={src() ?? ""}
          alt=""
          loading="lazy"
          class={`h-full w-full ${props.tall ? "object-contain" : "object-cover"} ${props.blurred ? "blur-xl" : ""}`}
          // A video's first frame is what an <img> cannot show; the poster
          // the author uploaded is fetched as its own blob by the viewer.
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")}
        />
      </Show>
      <Show when={video()}>
        <span class="absolute inset-0 flex items-center justify-center">
          <span class="flex h-11 w-11 items-center justify-center rounded-full bg-bg/70">
            <Play size={18} />
          </span>
        </span>
      </Show>
    </button>
  );
}

/** Full-size viewer: arrows, Escape, and the video actually plays. */
function Lightbox(props: { media: MediaRef[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const current = () => props.media[props.index]!;
  const [src] = createResource(
    () => current().cid,
    async (cid) => {
      try {
        return convertFileSrc(await ipc.feedMediaFetch(cid, current().mime));
      } catch {
        return null;
      }
    },
  );
  const step = (d: number) => {
    const n = props.media.length;
    props.onIndex((props.index + d + n) % n);
  };
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });
  return (
    <Portal>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-bg/95" role="dialog" aria-label="Media" onClick={props.onClose}>
        <button type="button" class="absolute right-3 top-3 btn-ghost btn-icon-sm" aria-label="Close" onClick={props.onClose}>
          <X size={16} />
        </button>
        <Show when={props.media.length > 1}>
          <button type="button" class="absolute left-3 btn-ghost btn-icon-sm" aria-label="Previous" onClick={(e) => { e.stopPropagation(); step(-1); }}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" class="absolute right-3 top-1/2 btn-ghost btn-icon-sm" aria-label="Next" onClick={(e) => { e.stopPropagation(); step(1); }}>
            <ChevronRight size={18} />
          </button>
        </Show>
        <div class="max-h-[88vh] max-w-[88vw]" onClick={(e) => e.stopPropagation()}>
          <Show when={src()} fallback={<p class="text-sm text-muted">Fetching from the network…</p>}>
            <Show when={current().mime.startsWith("video/")} fallback={<img src={src() ?? ""} alt="" class="max-h-[88vh] max-w-[88vw] object-contain" />}>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video src={src() ?? ""} class="max-h-[88vh] max-w-[88vw]" controls autoplay />
            </Show>
          </Show>
        </div>
        <Show when={props.media.length > 1}>
          <p class="absolute bottom-3 text-xs text-muted">
            {props.index + 1} / {props.media.length}
          </p>
        </Show>
      </div>
    </Portal>
  );
}
