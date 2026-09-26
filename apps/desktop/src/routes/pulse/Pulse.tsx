// Pulse: the screen Hashgram opens on.
//
// Four feeds, none of them ranked by anything the user cannot see:
//   Latest     every public post the nearest node holds, newest first
//   Following  the people you follow, from their own signed chains
//   Topics     subject pages anyone can open and post on
//   Local      Latest, kept to authors who published the country you chose
//
// Local is worth spelling out: the country comes from the author's own
// profile and from a country the user picked by hand. Nothing infers a
// location from an IP address, a peer or a clock.
import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Plus, RefreshCw, MapPin } from "lucide-solid";
import { Button, Empty, Skeleton, Tabs, Select, Notice } from "~/components/ui";
import { OfflineBanner, ErrorState } from "~/components/States";
import { ipc, errText, type FeedItem, type Profile } from "~/lib/ipc";
import { store } from "~/lib/store";
import { rememberTab, recallTab, trackScroll } from "~/lib/uistate";
import { PostCard, PostView, ComposeDialog, SourceLine, usePages } from "~/routes/feed/Feed";
import { DiscoveryRail } from "~/components/social/DiscoveryRail";
import { TopicsHome } from "~/routes/topics/Topics";

type Tab = "latest" | "following" | "topics" | "local";
const TAB_IDS: Tab[] = ["latest", "following", "topics", "local"];

export function PulseRoute() {
  const params = useParams<{ tab?: string; id?: string }>();
  const navigate = useNavigate();
  const [compose, setCompose] = createSignal(false);

  // /pulse/post/<id> opens one post; /pulse/tag/<tag> a hashtag page.
  const mode = () => {
    const t = params.tab ?? "";
    if (t === "post" && params.id) return { kind: "post" as const, id: params.id };
    if (t === "tag" && params.id) return { kind: "tag" as const, tag: decodeURIComponent(params.id) };
    return { kind: "feed" as const };
  };
  const tab = (): Tab => {
    const t = params.tab as Tab;
    return TAB_IDS.includes(t) ? t : (recallTab("pulse", "latest") as Tab);
  };
  createEffect(() => {
    if (mode().kind === "feed") rememberTab("pulse", tab());
  });

  return (
    <div class="flex h-full min-h-0">
      <div class="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <Show when={mode().kind === "post"} fallback={<PulseBody tab={tab()} mode={mode()} onCompose={() => setCompose(true)} />}>
          <PostView id={params.id!} onBack={() => (window.history.length > 1 ? window.history.back() : navigate("/pulse"))} />
        </Show>
      </div>
      <DiscoveryRail />
      <ComposeDialog open={compose()} onClose={() => setCompose(false)} />
    </div>
  );
}

function PulseBody(props: { tab: Tab; mode: { kind: string; tag?: string }; onCompose: () => void }) {
  const navigate = useNavigate();
  const tagged = () => (props.mode.kind === "tag" ? (props.mode.tag ?? "") : "");

  return (
    <>
      <div class="flex items-center gap-2 border-b border-border px-3">
        <Tabs
          class="flex-1 border-b-0"
          value={tagged() ? "" : props.tab}
          onChange={(v) => navigate(`/pulse/${v}`)}
          tabs={[
            { id: "latest", label: "Latest" },
            { id: "following", label: "Following" },
            { id: "topics", label: "Topics" },
            { id: "local", label: "Local" },
          ]}
        />
        <Button variant="ghost" size="icon-sm" title="Refresh" onClick={() => { void ipc.feedRefresh().catch(() => undefined); store.bump("feed"); }}>
          <RefreshCw size={13} />
        </Button>
        <Button variant="brand" size="sm" onClick={props.onCompose}>
          <Plus size={13} /> Post
        </Button>
      </div>
      <div class="min-h-0 flex-1 overflow-auto" ref={(el) => onCleanup(trackScroll(`scroll:pulse:${tagged() || props.tab}`, el))}>
        <div class="mx-auto max-w-2xl px-4 py-3">
          <Show when={tagged()} fallback={<FeedFor tab={props.tab} />}>
            <TagFeed tag={tagged()} />
          </Show>
        </div>
      </div>
    </>
  );
}

function FeedFor(props: { tab: Tab }) {
  return (
    <>
      <Show when={props.tab === "latest"}>
        <LatestFeed />
      </Show>
      <Show when={props.tab === "following"}>
        <FollowingFeed />
      </Show>
      <Show when={props.tab === "topics"}>
        <TopicsHome />
      </Show>
      <Show when={props.tab === "local"}>
        <LocalFeed />
      </Show>
    </>
  );
}

/** Everything public the nearest node holds, newest first. */
function LatestFeed() {
  const navigate = useNavigate();
  const pages = usePages((before) => ipc.hashwallExplore(before, 30), () => store.ticks().feed);
  return (
    <>
      <SourceLine page={pages.source()} />
      <Show when={pages.error()}>
        <ErrorState error={pages.error()} onRetry={() => void pages.reload()} />
      </Show>
      <Show when={pages.loading() && !pages.items().length}>
        <Skeleton lines={5} />
      </Show>
      <Show when={!pages.loading() && !pages.items().length}>
        <Empty title="Nothing here yet">The nodes you are connected to hold no public posts. Post something, or follow someone.</Empty>
      </Show>
      <For each={pages.items()}>{(it) => <PostCard it={it} onOpen={() => navigate(`/pulse/post/${it.id}`)} />}</For>
      <MoreLine pages={pages} />
    </>
  );
}

/** The people you follow, from their own chains — works offline. */
function FollowingFeed() {
  const navigate = useNavigate();
  const [items, { refetch }] = createResource(
    () => ({ tick: store.ticks().feed, locked: store.locked() }),
    (k) => (k.locked ? Promise.resolve([] as FeedItem[]) : ipc.feedFollowing(0, 100)),
  );
  return (
    <>
      <Show when={items.error}>
        <ErrorState error={items.error} onRetry={() => void refetch()} />
      </Show>
      <Show when={items.loading && !items()}>
        <Skeleton lines={5} />
      </Show>
      <Show when={items() && !items()!.length}>
        <Empty title="You do not follow anyone yet">Open somebody's profile from Latest or Topics and press Follow. Their posts then appear here, even offline.</Empty>
      </Show>
      <For each={items() ?? []}>{(it) => <PostCard it={it} onOpen={() => navigate(`/pulse/post/${it.id}`)} />}</For>
    </>
  );
}

/** Latest, kept to authors whose profile says the country the user picked. */
function LocalFeed() {
  const navigate = useNavigate();
  const country = () => (store.settings()?.social?.local_country ?? "").toUpperCase();
  const pages = usePages((before) => ipc.hashwallExplore(before, 50), () => ({ tick: store.ticks().feed, c: country() }));

  const [countries] = createResource(
    () => pages.items().map((i) => i.author),
    async (authors): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      for (const a of [...new Set(authors)]) {
        try {
          const p: Profile = await ipc.peopleProfileCached(a);
          out[a] = (p.country ?? "").toUpperCase();
        } catch {
          out[a] = "";
        }
      }
      return out;
    },
  );

  const local = createMemo(() => {
    const map = countries() ?? {};
    const c = country();
    return c ? pages.items().filter((i) => map[i.author] === c) : [];
  });

  const setCountry = async (v: string) => {
    const s = store.settings();
    if (!s) return;
    const next = structuredClone(s);
    next.social.local_country = v;
    try {
      await ipc.settingsSet(next);
      await store.refreshSettings();
    } catch (e) {
      store.toast(errText(e), "error");
    }
  };

  return (
    <>
      <div class="mb-3 flex items-center gap-2">
        <MapPin size={13} class="text-muted" />
        <span class="text-[13px] text-muted">Show posts from</span>
        <Select
          class="w-44"
          aria-label="Local country"
          value={country()}
          onChange={(v) => void setCountry(v)}
          options={[{ value: "", label: "Choose a country…" }, ...COUNTRIES.map((c) => ({ value: c.code, label: c.name }))]}
        />
      </div>
      <Show when={country()} fallback={<Notice title="Pick a country">Local shows posts by people who put that country on their own profile. Hashgram never works your location out from your connection.</Notice>}>
        <Show when={!countries.loading} fallback={<Skeleton lines={4} />}>
          <Show when={local().length} fallback={<Empty title={`Nobody near ${country()} has posted`}>Only people who publish this country on their profile show up here.</Empty>}>
            <For each={local()}>{(it) => <PostCard it={it} onOpen={() => navigate(`/pulse/post/${it.id}`)} />}</For>
          </Show>
        </Show>
        <MoreLine pages={pages} />
      </Show>
    </>
  );
}

/** One hashtag's posts. */
function TagFeed(props: { tag: string }) {
  const navigate = useNavigate();
  const pages = usePages((before) => ipc.hashwallExplore(before, 30, props.tag), () => ({ t: props.tag, tick: store.ticks().feed }));
  return (
    <>
      <div class="mb-3 flex items-center justify-between">
        <h1 class="text-base font-semibold">#{props.tag}</h1>
        <Button size="sm" variant="secondary" onClick={() => navigate("/pulse/latest")}>
          Back to Pulse
        </Button>
      </div>
      <SourceLine page={pages.source()} />
      <Show when={pages.loading() && !pages.items().length}>
        <Skeleton lines={4} />
      </Show>
      <Show when={!pages.loading() && !pages.items().length}>
        <Empty title={`No posts tagged #${props.tag}`} />
      </Show>
      <For each={pages.items()}>{(it) => <PostCard it={it} onOpen={() => navigate(`/pulse/post/${it.id}`)} />}</For>
      <MoreLine pages={pages} />
    </>
  );
}

function MoreLine(props: { pages: ReturnType<typeof usePages> }) {
  return (
    <div class="py-4 text-center" ref={props.pages.sentinel}>
      <Show when={!props.pages.done()} fallback={<span class="text-xs text-muted">That is everything this node holds.</span>}>
        <Button size="sm" variant="secondary" loading={props.pages.loading()} onClick={() => void props.pages.more()}>
          Load more
        </Button>
      </Show>
    </div>
  );
}

/** Countries the Local tab offers. Codes are ISO 3166-1 alpha-2. */
const COUNTRIES = [
  { code: "GE", name: "Georgia" },
  { code: "AM", name: "Armenia" },
  { code: "AZ", name: "Azerbaijan" },
  { code: "TR", name: "Türkiye" },
  { code: "UA", name: "Ukraine" },
  { code: "PL", name: "Poland" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "BR", name: "Brazil" },
  { code: "IN", name: "India" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "AU", name: "Australia" },
];
