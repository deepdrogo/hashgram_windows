// A public social profile: cover, avatar, name, bio, counts, and the four
// timelines a person's public activity is made of.
//
// Everything on this screen is derived from signed events. Where a number
// cannot be derived honestly — followers, which nobody's own chain records —
// the screen says so instead of showing a zero that looks like a fact.
import { For, Show, createResource, createSignal, createMemo, onCleanup } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Globe, MapPin, CalendarDays, MessageSquare, Mail as MailIcon, UserPlus, UserMinus, Pencil, Copy as CopyIcon } from "lucide-solid";
import { Button, Tabs, Empty, Skeleton, Badge, Dialog } from "~/components/ui";
import { ErrorState } from "~/components/States";
import { Avatar, Mono, forgetAvatar } from "~/components/identity";
import { ipc, errText, type ProfileView, type ProfileTab, type FeedItem } from "~/lib/ipc";
import { store } from "~/lib/store";
import { cachedResource } from "~/lib/cache";
import { copyText } from "~/lib/clipboard";
import { formatTime } from "~/lib/format";
import { rememberTab, recallTab, trackScroll } from "~/lib/uistate";
import { PostCard } from "~/routes/feed/Feed";
import { MediaTile } from "~/components/social/Media";
import { VerifiedBadge } from "~/components/social/Verified";
import { VerificationPanel } from "./Verification";
import { ProfileEditor } from "./ProfileEdit";
import { FollowList } from "./FollowList";
import { UsernameCard } from "./Username";

const TABS: { id: ProfileTab; label: string }[] = [
  { id: "posts", label: "Posts" },
  { id: "replies", label: "Replies" },
  { id: "media", label: "Media" },
  { id: "likes", label: "Likes" },
];

/** Resolves a public media CID to a local file the webview may show. */
async function imageSrc(cid: string): Promise<string | null> {
  if (!cid) return null;
  try {
    return convertFileSrc(await ipc.peopleAvatar(cid));
  } catch {
    return null;
  }
}

export function ProfileRoute() {
  const params = useParams<{ address?: string }>();
  const navigate = useNavigate();
  const [edit, setEdit] = createSignal(false);
  const [list, setList] = createSignal<"followers" | "following" | null>(null);
  const [busy, setBusy] = createSignal(false);

  const target = () => (params.address ?? "me").trim();
  const [profile, { refetch }] = cachedResource(
    () => ({ who: target(), tick: store.ticks().feed, locked: store.locked() }),
    (k) => (k.locked ? null : `profile:${k.who}`),
    async (k): Promise<ProfileView | null> => {
      if (k.locked) return null;
      return k.who === "me" ? ipc.profileMine() : ipc.profileOf(k.who);
    },
  );

  const tabKey = () => `profile:${target()}`;
  const [tab, setTabSignal] = createSignal<ProfileTab>(recallTab(tabKey(), "posts") as ProfileTab);
  const setTab = (t: ProfileTab) => {
    rememberTab(tabKey(), t);
    setTabSignal(t);
  };

  const [items] = cachedResource(
    () => ({ who: profile()?.address, tab: tab(), tick: store.ticks().feed }),
    (k) => (k.who ? `profile:timeline:${k.who}:${k.tab}` : null),
    async (k): Promise<FeedItem[]> => (k.who ? ipc.profileTimeline(k.who, k.tab, 0, 50) : []),
  );

  const [cover] = createResource(() => profile()?.banner_cid ?? "", imageSrc);
  const [avatar] = createResource(() => profile()?.avatar_cid ?? "", imageSrc);

  const handle = () => {
    const p = profile();
    if (!p) return "";
    return p.username ? `@${p.username}` : "";
  };
  const isMe = () => target() === "me" || profile()?.address === store.status()?.address;

  const follow = async (on: boolean) => {
    const p = profile();
    if (!p) return;
    setBusy(true);
    try {
      await ipc.peopleFollow(p.address, on);
      store.bump("feed", "people");
      await refetch();
    } catch (e) {
      store.toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const joined = createMemo(() => {
    const t = profile()?.stats.first_event ?? 0;
    return t ? formatTime(t) : "";
  });

  return (
    <div class="h-full overflow-auto" ref={(el) => onCleanup(trackScroll(`scroll:${tabKey()}`, el))}>
      <Show when={profile.error}>
        <ErrorState error={profile.error} onRetry={() => void refetch()} />
      </Show>
      <Show when={profile.loading && !profile()}>
        <div class="p-4">
          <Skeleton lines={6} />
        </div>
      </Show>
      <Show when={profile()}>
        {(p) => (
          <>
            <div class="relative">
              <div class="h-40 w-full bg-surface-2">
                <Show when={cover()}>
                  <img src={cover() ?? ""} alt="" class="h-40 w-full object-cover" />
                </Show>
              </div>
              <div class="px-5">
                <div class="-mt-9 flex items-end justify-between gap-3">
                  <div class="rounded-xl border-2 border-bg bg-bg">
                    <Avatar address={p().address} size={72} src={avatar() ?? null} />
                  </div>
                  <div class="mb-1 flex flex-wrap items-center gap-2">
                    <Show
                      when={!p().is_me}
                      fallback={
                        <Button size="sm" variant="secondary" onClick={() => setEdit(true)}>
                          <Pencil size={13} /> Edit profile
                        </Button>
                      }
                    >
                      <Button size="sm" variant={p().following ? "secondary" : "brand"} loading={busy()} onClick={() => void follow(!p().following)}>
                        <Show when={p().following} fallback={<UserPlus size={13} />}>
                          <UserMinus size={13} />
                        </Show>
                        {p().following ? "Following" : "Follow"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          try {
                            navigate(`/chats/${await ipc.chatOpen(p().address)}`);
                          } catch (e) {
                            store.toast(errText(e), "error");
                          }
                        }}
                      >
                        <MessageSquare size={13} /> Chat
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => navigate(`/mail?compose=1&to=${encodeURIComponent(p().username ? `@${p().username}` : p().address)}`)}>
                        <MailIcon size={13} /> Mail
                      </Button>
                    </Show>
                  </div>
                </div>

                <div class="mt-2">
                  <h1 class="flex items-center gap-1.5 text-lg font-semibold leading-tight">
                    {p().display_name || handle() || "Unnamed"}
                    <VerifiedBadge address={p().address} size={16} />
                  </h1>
                  <div class="mt-0.5 flex items-center gap-2 text-[13px] text-muted">
                    <Show when={handle()}>
                      <span class="mono">{handle()}</span>
                    </Show>
                    <Mono text={p().address} head={10} tail={6} copy />
                  </div>
                </div>

                <Show when={p().bio}>
                  <p class="mt-3 max-w-2xl whitespace-pre-wrap text-[13px] selectable">{p().bio}</p>
                </Show>

                <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <Show when={p().website}>
                    <span class="inline-flex items-center gap-1">
                      <Globe size={12} />
                      <button type="button" class="hover:text-fg hover:underline" onClick={() => void copyText(p().website)} title="Copy the address">
                        {p().website.replace(/^https?:\/\//, "")}
                      </button>
                    </span>
                  </Show>
                  <Show when={p().country}>
                    <span class="inline-flex items-center gap-1">
                      <MapPin size={12} /> {p().country}
                    </span>
                  </Show>
                  <Show when={joined()}>
                    <span class="inline-flex items-center gap-1" title="The first event of theirs this device has seen">
                      <CalendarDays size={12} /> Joined {joined()}
                    </span>
                  </Show>
                </div>

                <Show when={isMe()}>
                  <VerificationPanel />
                </Show>

                <div class="mt-3 flex flex-wrap items-center gap-4 text-[13px]">
                  <button type="button" class="hover:underline" onClick={() => setList("following")}>
                    <span class="tnum font-semibold">{p().stats.following}</span> <span class="text-muted">Following</span>
                  </button>
                  <Show
                    when={p().stats.followers !== null}
                    fallback={
                      <span class="text-muted" title="Counting followers needs an index over everyone's events. Set an indexer in Settings → Network.">
                        Followers <span class="text-muted">unknown</span>
                      </span>
                    }
                  >
                    <button type="button" class="hover:underline" onClick={() => setList("followers")}>
                      <span class="tnum font-semibold">{p().stats.followers}</span> <span class="text-muted">Followers</span>
                    </button>
                  </Show>
                  <span>
                    <span class="tnum font-semibold">{p().stats.posts}</span> <span class="text-muted">Posts</span>
                  </span>
                  <Show when={p().stats.source !== "indexer"}>
                    <Badge title="Counted from the events this device holds. Connect an indexer for network-wide totals.">
                      {p().stats.source === "device" ? "counted here" : "partial count"}
                    </Badge>
                  </Show>
                </div>
              </div>
            </div>

            <div class="mt-4 border-b border-border px-5">
              <Tabs class="border-b-0" value={tab()} onChange={(v) => setTab(v as ProfileTab)} tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} />
            </div>

            <div class="p-4">
              <Show when={p().is_me && tab() === "posts"}>
                <div class="mb-4">
                  <UsernameCard current={p().username} address={p().address} onRegistered={() => void refetch()} />
                </div>
              </Show>
              <Show when={items.loading && !items()}>
                <Skeleton lines={4} />
              </Show>
              <Show when={items() && !items()!.length}>
                <Empty title={emptyFor(tab(), p().is_me)} />
              </Show>
              <Show when={tab() === "media"} fallback={<For each={items() ?? []}>{(it) => <PostCard it={it} onOpen={() => navigate(`/pulse/post/${it.id}`)} />}</For>}>
                <MediaGrid items={items() ?? []} onOpen={(id) => navigate(`/pulse/post/${id}`)} />
              </Show>
            </div>

            <Dialog open={edit()} onClose={() => setEdit(false)} title="Edit profile">
              <ProfileEditor
                profile={p()}
                onSaved={async () => {
                  forgetAvatar(p().address);
                  setEdit(false);
                  store.bump("feed", "people");
                  await refetch();
                }}
              />
            </Dialog>
            <Dialog open={!!list()} onClose={() => setList(null)} title={list() === "followers" ? "Followers" : "Following"}>
              <Show when={list()}>{(which) => <FollowList address={p().address} which={which()} onOpen={(a) => { setList(null); navigate(`/profile/${a}`); }} />}</Show>
            </Dialog>
          </>
        )}
      </Show>
    </div>
  );
}

function emptyFor(tab: ProfileTab, mine: boolean): string {
  if (tab === "posts") return mine ? "You have not posted yet" : "No posts yet";
  if (tab === "replies") return "No public replies";
  if (tab === "media") return "No photos or videos";
  return "No public reactions";
}

/**
 * A profile's media is a view over its posts, never a separate library:
 * every tile belongs to a post and opening it opens that post.
 */
function MediaGrid(props: { items: FeedItem[]; onOpen: (id: string) => void }) {
  return (
    <div class="grid grid-cols-3 gap-2">
      <For each={props.items}>
        {(it) => (
          <For each={it.media}>{(m) => <MediaTile media={m} onOpen={() => props.onOpen(it.id)} />}</For>
        )}
      </For>
    </div>
  );
}
