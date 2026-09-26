// Reels: the network's short video, one at a time.
//
// Not a separate kind of content with its own feed to fill. A reel here is
// any public post carrying a video — `REEL_CREATE`, which the protocol has
// always had, and ordinary posts with a video attached — pulled from the
// same pages Pulse already reads. That is what makes it work on day one:
// it shows what people are actually posting rather than waiting for them
// to use a new button.
//
// The order is what the rest of Pulse uses: newest first. There is no
// engagement score deciding what you watch next, because a ranking nobody
// can inspect is the one thing this network is not going to have.
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronUp, ChevronDown, Heart, MessageSquare, Repeat2, Volume2, VolumeX, Film } from "lucide-solid";
import { Button, Empty, Skeleton } from "~/components/ui";
import { PersonAvatar, Who } from "~/components/identity";
import { ipc, errText, type FeedItem } from "~/lib/ipc";
import { store } from "~/lib/store";
import { cachedResource } from "~/lib/cache";
import { prefetchMedia } from "~/lib/prefetch";
import { shortWhen } from "~/lib/format";
import { postText } from "~/routes/feed/Feed";

/** A post counts as a reel when it carries a video. */
function videoOf(it: FeedItem): [string, string] | null {
  const v = it.media.find(([, mime]) => mime.startsWith("video/"));
  return v ? [v[0], v[1]] : null;
}

export function Reels() {
  const navigate = useNavigate();
  const [index, setIndex] = createSignal(0);
  const [muted, setMuted] = createSignal(true);

  // One wide page of the public timeline, filtered to what has video.
  // Asking for reels only would miss the videos people attach to ordinary
  // posts, which today is most of them.
  const [page] = cachedResource(
    () => ({ tick: store.ticks().feed, locked: store.locked() }),
    (k) => (k.locked ? null : "pulse:reels"),
    (k) => (k.locked ? Promise.resolve(null) : ipc.hashwallExplore(0, 100).catch(() => null)),
  );

  const reels = createMemo(() => (page()?.items ?? []).filter((it) => videoOf(it)));
  const current = () => reels()[index()];

  // Warm the next two, so moving down the list does not wait on a fetch.
  createEffect(() => {
    for (const it of reels().slice(index(), index() + 3)) {
      const v = videoOf(it);
      if (v) prefetchMedia(v[0], v[1]);
    }
  });

  const step = (d: number) => {
    const n = reels().length;
    if (!n) return;
    setIndex((i) => Math.min(n - 1, Math.max(0, i + d)));
  };

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "j") step(1);
      else if (e.key === "ArrowUp" || e.key === "k") step(-1);
      else if (e.key === "m") setMuted((m) => !m);
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <div class="flex h-full min-h-0 flex-col items-center">
      <Show when={page.loading && !page()}>
        <div class="w-full max-w-md p-4">
          <Skeleton lines={6} />
        </div>
      </Show>
      <Show when={page() && !reels().length}>
        <Empty title="No video on the network yet" icon={<Film size={18} />}>
          Reels are the short videos people post. Attach one to a post and it shows up here.
        </Empty>
      </Show>
      <Show when={current()}>
        {(it) => (
          <div class="relative flex min-h-0 w-full max-w-md flex-1 flex-col">
            <ReelStage item={it()} muted={muted()} onEnded={() => step(1)} />

            <div class="absolute inset-x-0 bottom-0 flex items-end gap-3 bg-gradient-to-t from-bg to-transparent p-3">
              <div class="min-w-0 flex-1">
                <button type="button" class="flex items-center gap-2" onClick={() => navigate(`/profile/${it().author}`)}>
                  <PersonAvatar address={it().author} size={26} />
                  <Who address={it().author} size="sm" />
                  <span class="text-[11px] text-muted">{shortWhen(it().timestamp * 1000)}</span>
                </button>
                <Show when={postText(it())}>
                  <p class="mt-1 line-clamp-2 text-[13px] selectable">{postText(it())}</p>
                </Show>
              </div>
              <div class="flex shrink-0 flex-col items-center gap-2">
                <ReelAction
                  icon={<Heart size={16} />}
                  label="Like"
                  onClick={async () => {
                    try {
                      await ipc.feedReact(it().id, "❤");
                      store.bump("feed");
                    } catch (e) {
                      store.toast(errText(e), "error");
                    }
                  }}
                />
                <ReelAction icon={<MessageSquare size={16} />} label="Comments" onClick={() => navigate(`/pulse/post/${it().id}`)} />
                <ReelAction
                  icon={<Repeat2 size={16} />}
                  label="Repost"
                  onClick={async () => {
                    try {
                      await ipc.feedRepost(it().id, "");
                      store.toast("Reposted");
                      store.bump("feed");
                    } catch (e) {
                      store.toast(errText(e), "error");
                    }
                  }}
                />
                <ReelAction icon={muted() ? <VolumeX size={16} /> : <Volume2 size={16} />} label={muted() ? "Unmute" : "Mute"} onClick={() => setMuted((m) => !m)} />
              </div>
            </div>

            <div class="absolute right-2 top-1/2 flex -translate-y-1/2 flex-col gap-1">
              <Button size="icon-sm" variant="ghost" aria-label="Previous" disabled={index() === 0} onClick={() => step(-1)}>
                <ChevronUp size={16} />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Next" disabled={index() >= reels().length - 1} onClick={() => step(1)}>
                <ChevronDown size={16} />
              </Button>
            </div>
          </div>
        )}
      </Show>
      <Show when={reels().length}>
        <p class="py-2 text-[11px] text-muted">
          {index() + 1} of {reels().length} · newest first, no ranking · <span class="mono">j</span>/<span class="mono">k</span> to move
        </p>
      </Show>
    </div>
  );
}

/** The video itself, fetched from the network and played once ready. */
function ReelStage(props: { item: FeedItem; muted: boolean; onEnded: () => void }) {
  const [src] = cachedResource(
    () => videoOf(props.item),
    (v) => (v ? `reel:${v[0]}` : null),
    async (v) => {
      if (!v) return null;
      try {
        return convertFileSrc(await ipc.feedMediaFetch(v[0], v[1]));
      } catch {
        return null;
      }
    },
  );
  return (
    <div class="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-2">
      <Show when={src()} fallback={<p class="text-xs text-muted">{src.loading ? "Fetching from the network…" : "This video is not on a reachable node."}</p>}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video src={src() ?? ""} class="max-h-full w-full object-contain" autoplay loop={false} muted={props.muted} controls={false} onEnded={props.onEnded} />
      </Show>
    </div>
  );
}

function ReelAction(props: { icon: unknown; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-muted hover:text-fg"
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
    >
      {props.icon as never}
    </button>
  );
}
