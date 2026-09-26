// Showing pictures and video in a feed.
//
// A post carries a CID, not bytes, so every tile is a fetch — and on this
// network a fetch means asking a node for a blob, not reading a CDN. Three
// rules keep that from hurting:
//
//   1. Nothing loads until it is near the viewport.
//   2. A video tile loads the **poster** and nothing else. The poster is a
//      small JPEG of the first frame that the author's own client made at
//      upload time; the video itself is megabytes and is fetched only when
//      somebody opens it. That is what "low quality first" means here — we
//      cannot transcode on the fly without a server in the middle, and this
//      network does not have one.
//   3. The space a tile will occupy is reserved from the author's declared
//      width and height, so the feed does not jump as blobs arrive.
//
// The bug this file was rewritten for: a video tile put the video's bytes
// in an <img>, which of course never decoded, so the tile hid itself and
// collapsed to a bar with a play button — after downloading the whole file
// to draw nothing.
import { For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { convertFileSrc } from "@tauri-apps/api/core";
import { X, ChevronLeft, ChevronRight, Play, Volume2, VolumeX, ExternalLink, Film } from "lucide-solid";
import { ipc, errText, type FeedItem, type PostMedia } from "~/lib/ipc";
import { store } from "~/lib/store";

export type MediaRef = PostMedia;

const isVideo = (m: MediaRef) => m.mime.startsWith("video/") || m.kind === "video";

/** Aspect ratio the author declared, or a sane default per kind. */
function ratio(m: MediaRef): string {
  if (m.width > 0 && m.height > 0) return `${m.width} / ${m.height}`;
  return isVideo(m) ? "16 / 9" : "1 / 1";
}

/** `1:04`, from the duration the author's client measured. */
function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The media attached to one post, as the card shows it. */
export function MediaStrip(props: { item: FeedItem; sensitive?: boolean }) {
  const [open, setOpen] = createSignal<number | null>(null);
  const media = () => props.item.media;
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

/** One tile, for a grid that is a view over posts. */
export function MediaTile(props: { media: MediaRef; onOpen: () => void }) {
  return <Tile media={props.media} onOpen={props.onOpen} />;
}

function Tile(props: { media: MediaRef; blurred?: boolean; tall?: boolean; onOpen: () => void }) {
  const { near, watch } = useNearby();
  const video = () => isVideo(props.media);
  // For a video this is the poster blob, which is a thumbnail-sized JPEG.
  // For a picture it is the picture. Either way one small-ish fetch, and
  // never the video itself.
  const preview = () => (video() ? props.media.poster_cid : props.media.cid);
  const [src] = createResource(
    () => (near() && preview() ? { cid: preview(), mime: video() ? "image/jpeg" : props.media.mime } : null),
    async (m) => {
      try {
        return convertFileSrc(await ipc.feedMediaFetch(m.cid, m.mime));
      } catch {
        return null;
      }
    },
  );
  const [broken, setBroken] = createSignal(false);
  return (
    <button
      type="button"
      ref={watch}
      // The box exists before the bytes do, at the shape the author
      // declared, so arriving media does not shove the feed around.
      style={{ "aspect-ratio": props.tall ? ratio(props.media) : "1 / 1", "max-height": props.tall ? "420px" : undefined }}
      class="relative w-full overflow-hidden rounded-md border border-border bg-surface-2"
      onClick={props.onOpen}
      title={video() ? "Play" : "Open"}
    >
      <Show when={src() && !broken()}>
        <img
          src={src() ?? ""}
          alt=""
          loading="lazy"
          class={`h-full w-full ${props.tall ? "object-contain" : "object-cover"} ${props.blurred ? "blur-xl" : ""}`}
          onError={() => setBroken(true)}
        />
      </Show>

      <Show when={video()}>
        {/* Says "video" even with no poster, instead of an empty box. */}
        <Show when={!src() || broken()}>
          <span class="absolute inset-0 flex items-center justify-center text-muted">
            <Film size={22} />
          </span>
        </Show>
        <span class="absolute inset-0 flex items-center justify-center">
          <span class="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-bg/70">
            <Play size={20} />
          </span>
        </span>
        <Show when={props.media.duration_ms > 0}>
          <span class="absolute bottom-1.5 right-1.5 rounded bg-bg/80 px-1.5 py-0.5 text-[10.5px] tnum text-fg">{clock(props.media.duration_ms)}</span>
        </Show>
      </Show>
    </button>
  );
}

/**
 * Full-size viewer.
 *
 * A video starts playing by itself and starts silent. Sound is a decision:
 * a feed that shouts at you the moment you tap something is a feed people
 * learn to tap carefully, and every browser blocks autoplay with sound
 * anyway. The unmute control is right there, and the choice sticks for the
 * rest of the session.
 */
let soundOn = false;

function Lightbox(props: { media: MediaRef[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const current = () => props.media[props.index]!;
  const video = () => isVideo(current());
  const [muted, setMuted] = createSignal(!soundOn);
  const [failed, setFailed] = createSignal(false);

  // The poster shows immediately; the video replaces it when it arrives.
  const [poster] = createResource(
    () => (video() && current().poster_cid ? current().poster_cid : null),
    async (cid) => {
      try {
        return convertFileSrc(await ipc.feedMediaFetch(cid, "image/jpeg"));
      } catch {
        return null;
      }
    },
  );
  const [file] = createResource(
    () => ({ cid: current().cid, mime: current().mime }),
    async (m) => {
      try {
        return await ipc.feedMediaFetch(m.cid, m.mime);
      } catch {
        return null;
      }
    },
  );
  const src = () => (file() ? convertFileSrc(file()!) : null);

  const step = (d: number) => {
    const n = props.media.length;
    setFailed(false);
    props.onIndex((props.index + d + n) % n);
  };
  const setSound = (on: boolean) => {
    soundOn = on;
    setMuted(!on);
  };
  const openOutside = async () => {
    try {
      await ipc.feedMediaOpen(current().cid, current().mime);
    } catch (e) {
      store.toast(errText(e), "error");
    }
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key.toLowerCase() === "m") setSound(muted());
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

        <div class="relative max-h-[88vh] max-w-[88vw]" onClick={(e) => e.stopPropagation()}>
          <Show
            when={video()}
            fallback={
              <Show when={src()} fallback={<p class="text-sm text-muted">Fetching from the network…</p>}>
                <img src={src() ?? ""} alt="" class="max-h-[88vh] max-w-[88vw] object-contain" />
              </Show>
            }
          >
            {/* Until the video arrives, the poster holds the frame at the
                right size rather than the screen sitting empty. */}
            <Show when={src() && !failed()} fallback={<VideoPlaceholder media={current()} poster={poster()} loading={file.loading} failed={failed()} onOutside={() => void openOutside()} />}>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={src() ?? ""}
                poster={poster() ?? undefined}
                class="max-h-[88vh] max-w-[88vw] bg-surface-2"
                controls
                autoplay
                muted={muted()}
                playsinline
                onError={() => setFailed(true)}
              />
            </Show>

            <Show when={src() && !failed()}>
              <div class="absolute left-2 top-2 flex items-center gap-1.5">
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-border bg-bg/80 px-2 py-1 text-[11px]"
                  onClick={() => setSound(muted())}
                  title="M"
                >
                  <Show when={muted()} fallback={<><Volume2 size={12} /> Sound on</>}>
                    <VolumeX size={12} /> Sound off — click for sound
                  </Show>
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-1 rounded-full border border-border bg-bg/80 px-2 py-1 text-[11px] text-muted hover:text-fg"
                  onClick={() => void openOutside()}
                  title="Open the downloaded file in your own player"
                >
                  <ExternalLink size={12} /> Open in your player
                </button>
              </div>
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

/** The poster, while the video downloads — or instead of it, when the
 *  webview cannot decode the file. Windows ships codecs for H.264/AAC in
 *  MP4 and for WebM; anything else is the author's file being fine and this
 *  webview not knowing it, which is a thing to say plainly and hand over to
 *  a real player rather than show a black rectangle about. */
function VideoPlaceholder(props: { media: MediaRef; poster: string | null | undefined; loading: boolean; failed: boolean; onOutside: () => void }) {
  return (
    <div class="relative flex items-center justify-center" style={{ "aspect-ratio": ratio(props.media), width: "min(88vw, 900px)", "max-height": "88vh" }}>
      <Show when={props.poster}>
        <img src={props.poster ?? ""} alt="" class="absolute inset-0 h-full w-full object-contain opacity-60" />
      </Show>
      <div class="relative flex flex-col items-center gap-2 rounded-md border border-border bg-bg/80 px-4 py-3 text-center">
        <Show
          when={props.failed}
          fallback={
            <>
              <span class="inline-block h-4 w-4 animate-spin rounded-full border border-current border-t-transparent" aria-hidden="true" />
              <p class="text-xs text-muted">Fetching the video from the network…</p>
              <Show when={props.media.size > 0}>
                <p class="text-[11px] text-muted tnum">{(props.media.size / 1_000_000).toFixed(1)} MB</p>
              </Show>
            </>
          }
        >
          <p class="text-[13px]">This window cannot play that format</p>
          <p class="text-[11px] text-muted">The file downloaded fine. Windows' built-in player handles more formats than the app's webview does.</p>
          <button type="button" class="btn-secondary btn-sm" onClick={props.onOutside}>
            <ExternalLink size={12} /> Open in your player
          </button>
        </Show>
      </div>
    </div>
  );
}
