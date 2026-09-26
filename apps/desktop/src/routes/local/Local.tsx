// Local: everything happening in one country, on purpose.
//
// The whole page rests on one rule, and the rule is the reason it can exist
// at all: a country here is **self-declared**. It is an attribute the author
// signed into their own profile. Nothing on this page is inferred from an IP
// address, a node, a connection or a language, because a decentralised
// network that guessed where you were would be worse than a centralised one
// that asked.
//
// That rule also sets the honest limits, which the page states rather than
// hides:
//
//   * Someone who has not filled in a country is not here. They are not
//     missing from the country — they are missing from the list, and the
//     page says how many it looked at.
//   * "Accounts" means accounts this device has seen evidence of. There is
//     no registry of everyone in a country and this app will not invent one.
//   * Top holders come from the leaderboard an indexer answered with, so
//     the ranking is "of the holders that indexer returned". A balance is on
//     chain and checkable; the completeness of a list is not.
import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { MapPin, Users, Compass, Image as ImageIcon, Hash, Megaphone } from "lucide-solid";
import { Badge, Button, Card, Empty, Notice, Select, Skeleton, Stat, Tabs } from "~/components/ui";
import { Mono, PersonAvatar, Who } from "~/components/identity";
import { VerifiedBadge } from "~/components/social/Verified";
import { MediaTile } from "~/components/social/Media";
import { PostCard } from "~/routes/feed/Feed";
import { ipc, errText, type FeedItem, type Profile, type SpaceListing } from "~/lib/ipc";
import { store } from "~/lib/store";
import { cachedResource } from "~/lib/cache";
import { COUNTRIES, countryName } from "~/lib/countries";
import { formatHash } from "~/lib/format";
import { pick, str, arr } from "~/lib/chain";

type Tab = "posts" | "media" | "people" | "spaces";

/** The hashtags an event's payload carries, lowercased and deduplicated. */
function tagsOf(it: FeedItem): string[] {
  const raw = it.payload["hashtags"];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((t): t is string => typeof t === "string").map((t) => t.replace(/^#/, "").toLowerCase()))];
}

export function LocalRoute() {
  const navigate = useNavigate();
  const [tab, setTab] = createSignal<Tab>("posts");
  const country = () => (store.settings()?.social?.local_country ?? "").toUpperCase();

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

  // One wide page of the public timeline. Everything on this screen is a
  // view over it plus the profiles of its authors, so the country filter
  // costs no extra round trip per section.
  const [page] = cachedResource(
    () => ({ tick: store.ticks().feed, locked: store.locked() }),
    (k) => (k.locked ? null : "local:page"),
    (k) => (k.locked ? Promise.resolve(null) : ipc.hashwallExplore(0, 100).catch(() => null)),
  );

  const authors = createMemo(() => [...new Set((page()?.items ?? []).map((i) => i.author))]);

  /** address → declared country, for every author on the page. */
  const [declared] = createResource(authors, async (list): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const a of list) {
      try {
        const p: Profile = await ipc.peopleProfileCached(a);
        out[a] = (p.country ?? "").toUpperCase();
      } catch {
        out[a] = "";
      }
    }
    return out;
  });

  const isHere = (address: string) => (declared()?.[address] ?? "") === country();
  const posts = createMemo(() => (page()?.items ?? []).filter((i) => isHere(i.author)));
  const people = createMemo(() => authors().filter(isHere));
  const withMedia = createMemo(() => posts().filter((p) => p.media.length));
  const declaredCount = createMemo(() => Object.values(declared() ?? {}).filter(Boolean).length);

  // Subjects come from the tags people wrote, read out of the post payload
  // the same way the rest of Pulse reads them.
  const hashtags = createMemo(() => {
    const n = new Map<string, number>();
    for (const p of posts()) {
      for (const t of tagsOf(p)) n.set(t, (n.get(t) ?? 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  });

  return (
    <div class="h-full overflow-auto">
      <div class="page flex flex-col gap-4">
        <div class="flex items-center justify-between gap-3">
          <h1 class="page-title flex items-center gap-2">
            <MapPin size={16} class="text-muted" />
            Local
            <Show when={country()}>
              <span class="text-muted">· {countryName(country())}</span>
            </Show>
          </h1>
          <Select
            class="w-52"
            aria-label="Local country"
            value={country()}
            onChange={(v) => void setCountry(v)}
            options={[{ value: "", label: "Choose a country…" }, ...COUNTRIES.map((c) => ({ value: c.code, label: c.name }))]}
          />
        </div>

        <Show
          when={country()}
          fallback={
            <Notice title="Pick a country">
              Local gathers the people, posts, pictures and Spaces of one country. A country is what an author put on their own profile —
              Hashgram never works out where you are from your connection.
            </Notice>
          }
        >
          <Show when={!page() && page.loading} fallback={null}>
            <Skeleton lines={4} />
          </Show>

          <div class="grid grid-cols-4 gap-3">
            <Stat
              label={`Accounts from ${countryName(country())}`}
              value={String(people().length)}
              sub={`of ${declaredCount()} that declare any country, in ${authors().length} authors seen`}
            />
            <Stat label="Posts here" value={String(posts().length)} sub="in the page of public posts read above" />
            <Stat label="Pictures and video" value={String(withMedia().length)} sub="posts carrying media" />
            <Stat label="Subjects" value={String(hashtags().length)} sub="hashtags used here" />
          </div>

          <TopHoldersHere country={country()} />

          <Show when={hashtags().length}>
            <Card title="What people here are talking about">
              <div class="flex flex-wrap gap-1.5 p-3">
                <For each={hashtags()}>
                  {([tag, n]) => (
                    <button type="button" class="badge hover:border-accent hover:text-fg" onClick={() => navigate(`/pulse/tag/${tag}`)}>
                      <Hash size={10} class="mr-1" />
                      {tag} <span class="ml-1 tnum text-muted">{n}</span>
                    </button>
                  )}
                </For>
              </div>
            </Card>
          </Show>

          <Tabs
            value={tab()}
            onChange={(v) => setTab(v as Tab)}
            tabs={[
              { id: "posts", label: "Posts", badge: posts().length },
              { id: "media", label: "Pictures and video", badge: withMedia().length },
              { id: "people", label: "People", badge: people().length },
              { id: "spaces", label: "Spaces" },
            ]}
          />

          <Show when={tab() === "posts"}>
            <Show
              when={posts().length}
              fallback={
                <Empty title={`Nobody who declares ${countryName(country())} has posted here yet`}>
                  Only people who publish this country on their own profile appear in Local. Put yours on your profile and your posts show up
                  for everyone else who picked it.
                </Empty>
              }
            >
              <div class="mx-auto w-full max-w-2xl">
                <For each={posts()}>{(it) => <PostCard it={it} onOpen={() => navigate(`/pulse/post/${it.id}`)} />}</For>
              </div>
            </Show>
          </Show>

          <Show when={tab() === "media"}>
            <Show when={withMedia().length} fallback={<Empty title="No pictures or video from here yet" icon={<ImageIcon size={18} />} />}>
              <div class="grid grid-cols-4 gap-2">
                <For each={withMedia()}>
                  {(p) => (
                    <MediaTile media={p.media[0]!} onOpen={() => navigate(`/pulse/post/${p.id}`)} />
                  )}
                </For>
              </div>
            </Show>
          </Show>

          <Show when={tab() === "people"}>
            <Show when={people().length} fallback={<Empty title="Nobody here yet" icon={<Users size={18} />} />}>
              <Card>
                <ul>
                  <For each={people()}>
                    {(a) => (
                      <li class="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0">
                        <PersonAvatar address={a} size={28} />
                        <Who address={a} class="flex-1" />
                        <VerifiedBadge address={a} />
                        <span class="tnum text-[11px] text-muted">{posts().filter((p) => p.author === a).length} posts</span>
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/profile/${a}`)}>
                          Open
                        </Button>
                      </li>
                    )}
                  </For>
                </ul>
              </Card>
            </Show>
          </Show>

          <Show when={tab() === "spaces"}>
            <LocalSpaces country={country()} declared={declared()} />
          </Show>

          <p class="text-[11px] text-muted">
            Everything above is drawn from posts the nodes you are connected to hold, and from profiles that declare a country. It is not a
            census: there is no list of everyone in a country, and this app will not pretend to have one.
          </p>
        </Show>
      </div>
    </div>
  );
}

/** Balances on chain, ranked among the holders an indexer returned. */
function TopHoldersHere(props: { country: string }) {
  const navigate = useNavigate();
  const [rows] = cachedResource(
    () => ({ c: props.country, tick: store.ticks().network, locked: store.locked() }),
    (k) => (k.locked ? null : `local:holders:${k.c}`),
    async (k) => {
      if (k.locked) return null;
      const board = await ipc.networkTop("holders", 200).catch(() => null);
      if (!board) return null;
      const list = arr(pick(board, "rows") ?? pick(board, "items") ?? board);
      const out: { address: string; amount: string; username: string }[] = [];
      for (const r of list) {
        const address = str(pick(r, "address"));
        if (!address) continue;
        try {
          const p: Profile = await ipc.peopleProfileCached(address);
          if ((p.country ?? "").toUpperCase() !== k.c) continue;
          out.push({ address, amount: str(pick(r, "amount") ?? pick(r, "tokens"), "0"), username: p.username ?? "" });
        } catch {
          // A profile we cannot read is a profile that declares nothing.
        }
        if (out.length >= 10) break;
      }
      return out;
    },
  );

  return (
    <Card
      title={`Largest HASH balances declaring ${countryName(props.country)}`}
      actions={<span class="text-[11px] text-muted">balances from the chain · the list of holders from an indexer</span>}
    >
      <Show when={rows()} fallback={<p class="p-4 text-xs text-muted">{rows.loading ? "Reading the leaderboard…" : "No indexer answered, so there is no holder list to filter. Add one in Settings → Network."}</p>}>
        {(list) => (
          <Show when={list().length} fallback={<p class="p-4 text-xs text-muted">None of the holders the indexer returned declares this country.</p>}>
            <table class="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Account</th>
                  <th class="text-right">HASH</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <For each={list()}>
                  {(r, i) => (
                    <tr>
                      <td class="tnum">{i() + 1}</td>
                      <td>
                        <span class="flex items-center gap-2">
                          <PersonAvatar address={r.address} size={22} />
                          <Show when={r.username} fallback={<Mono text={r.address} head={12} tail={6} copy />}>
                            <span class="mono">@{r.username}</span>
                          </Show>
                          <VerifiedBadge address={r.address} />
                        </span>
                      </td>
                      <td class="tnum text-right">{formatHash(r.amount, 0, 0)}</td>
                      <td class="text-right">
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/profile/${r.address}`)}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <p class="border-t border-border px-3 py-2 text-[11px] text-muted">
              A rank here means "of the holders that indexer listed, filtered to profiles declaring this country". Each balance itself is on
              the public chain and can be checked against any node.
            </p>
          </Show>
        )}
      </Show>
    </Card>
  );
}

/** Public Space listings whose owner declares this country. */
function LocalSpaces(props: { country: string; declared: Record<string, string> | undefined }) {
  const navigate = useNavigate();
  const [listings] = cachedResource(
    () => ({ tick: store.ticks().spaces, locked: store.locked() }),
    (k) => (k.locked ? null : "local:spaces"),
    (k) => (k.locked ? Promise.resolve([] as SpaceListing[]) : ipc.spacesDirectory(undefined, "popular").catch(() => [] as SpaceListing[])),
  );
  const [owners] = createResource(
    () => (listings() ?? []).map((l) => l.owner),
    async (list): Promise<Record<string, string>> => {
      const out: Record<string, string> = {};
      for (const a of [...new Set(list)]) {
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
  const here = createMemo(() =>
    (listings() ?? []).filter((l) => (owners()?.[l.owner] ?? props.declared?.[l.owner] ?? "") === props.country || l.category === "Local"),
  );

  return (
    <Card title={`Spaces open to join around ${countryName(props.country)}`} actions={<span class="text-[11px] text-muted">listings are public; the Spaces themselves are not</span>}>
      <Show
        when={here().length}
        fallback={
          <Empty title="No Space here has published a listing" icon={<Compass size={18} />}>
            A Space is private by default. Its owner can publish a listing so people can find it and ask to join — from the Space's Overview
            tab. Listings from this country show up here.
          </Empty>
        }
      >
        <ul>
          <For each={here()}>
            {(l) => (
              <li class="flex items-start gap-3 border-b border-border px-3 py-3 last:border-0">
                <PersonAvatar address={l.owner} size={30} />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate text-[13px] font-medium">{l.name}</span>
                    <Badge>{l.category}</Badge>
                    <VerifiedBadge address={l.owner} />
                  </div>
                  <Show when={l.description}>
                    <p class="mt-0.5 line-clamp-2 text-xs text-muted selectable">{l.description}</p>
                  </Show>
                  <div class="mt-1 flex items-center gap-3 text-[11px] text-muted">
                    <Who address={l.owner} size="sm" />
                    <span class="inline-flex items-center gap-1" title="Public posts on the listing, counted by the node that answered">
                      <Megaphone size={11} /> {l.posts}
                    </span>
                    <span class="inline-flex items-center gap-1">
                      <Users size={11} /> {l.authors}
                    </span>
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => navigate("/spaces")}>
                  <Compass size={12} /> Directory
                </Button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </Card>
  );
}

