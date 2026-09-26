// Discover: the public directory of Spaces.
//
// A Space is an MLS group — its messages are unreadable to anyone outside
// it, and that does not change because the owner wants to be found. So a
// "public Space" here means a public *listing*: a signed channel event that
// gossips across the network carrying the name, the category and the owner,
// so people can find a Space and ask to join it. The group itself stays
// shut until the owner adds them.
//
// Popularity is the public activity on that listing, as counted by the node
// that answered. It is not a global figure and the page does not pretend it
// is one. Sorting by it is still useful, and it is honest about its source.
import { For, Show, createMemo, createSignal } from "solid-js";
import { Compass, Users, MessageSquarePlus, Megaphone } from "lucide-solid";
import { Badge, Button, Empty, Skeleton, Select } from "~/components/ui";
import { PersonAvatar, Who } from "~/components/identity";
import { VerifiedBadge } from "~/components/social/Verified";
import { ipc, errText, type SpaceListing } from "~/lib/ipc";
import { store } from "~/lib/store";
import { cachedResource } from "~/lib/cache";
import { shortWhen } from "~/lib/format";
import { go } from "~/lib/nav";

const ALL = "All categories";

export function SpacesDiscover() {
  const [category, setCategory] = createSignal(ALL);
  const [sort, setSort] = createSignal<"popular" | "new">("popular");

  const [categories] = cachedResource(
    () => store.locked(),
    (locked) => (locked ? null : "space:categories"),
    (locked) => (locked ? Promise.resolve([]) : ipc.spacesCategories().catch(() => [])),
  );
  const [listings] = cachedResource(
    () => ({ c: category(), s: sort(), tick: store.ticks().spaces, locked: store.locked() }),
    (k) => (k.locked ? null : `space:dir:${k.c}:${k.s}`),
    (k) => (k.locked ? Promise.resolve([]) : ipc.spacesDirectory(k.c === ALL ? undefined : k.c, k.s).catch(() => [])),
  );

  const rows = createMemo(() => listings() ?? []);

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex items-center gap-2 border-b border-border px-3 py-2">
        <Compass size={14} class="text-muted" />
        <h2 class="flex-1 text-[13px] font-medium">Public Spaces</h2>
        <Select
          value={category()}
          onChange={setCategory}
          aria-label="Category"
          options={[{ value: ALL, label: ALL }, ...(categories() ?? []).map((c) => ({ value: c, label: c }))]}
        />
        <Select
          value={sort()}
          onChange={(v) => setSort(v as "popular" | "new")}
          aria-label="Sort"
          options={[
            { value: "popular", label: "Most active" },
            { value: "new", label: "Newest" },
          ]}
        />
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        <Show when={!listings.loading || rows().length} fallback={<div class="p-3"><Skeleton lines={5} /></div>}>
          <Show
            when={rows().length}
            fallback={
              <Empty title="No public Spaces found" icon={<Compass size={18} />}>
                Listings travel the network as ordinary public events, so this fills up as owners publish their Spaces. Publish yours from its
                Overview tab.
              </Empty>
            }
          >
            <ul>
              <For each={rows()}>{(l) => <ListingRow listing={l} />}</For>
            </ul>
          </Show>
        </Show>
      </div>

      <p class="border-t border-border px-3 py-2 text-[11px] text-muted">
        A listing is public; the Space is not. Joining is the owner's decision — "Ask to join" sends them a message.
      </p>
    </div>
  );
}

function ListingRow(props: { listing: SpaceListing }) {
  const l = () => props.listing;
  const mine = () => l().owner === store.status()?.address;
  const ask = async () => {
    try {
      const id = await ipc.chatOpen(l().owner);
      await ipc.chatSend(id, `I would like to join your Space "${l().name}".`);
      store.toast("Message sent to the owner");
      go(`/chats/${id}`);
    } catch (e) {
      store.toast(errText(e), "error");
    }
  };
  return (
    <li class="flex items-start gap-3 border-b border-border px-3 py-3 last:border-0">
      <PersonAvatar address={l().owner} size={34} />
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="truncate text-[13px] font-medium">{l().name}</span>
          <Badge>{l().category}</Badge>
          <VerifiedBadge address={l().owner} />
        </div>
        <Show when={l().description}>
          <p class="mt-0.5 line-clamp-2 text-xs text-muted selectable">{l().description}</p>
        </Show>
        <div class="mt-1 flex items-center gap-3 text-[11px] text-muted">
          <Who address={l().owner} size="sm" />
          <span class="inline-flex items-center gap-1" title="Public posts on the listing, counted by the node that answered">
            <Megaphone size={11} /> {l().posts}
          </span>
          <span class="inline-flex items-center gap-1" title="Distinct posters, counted by the same node">
            <Users size={11} /> {l().authors}
          </span>
          <Show when={l().last_post}>
            <span>active {shortWhen(l().last_post * 1000)}</span>
          </Show>
        </div>
      </div>
      <div class="flex shrink-0 flex-col gap-1">
        <Button size="sm" variant="secondary" onClick={() => go(`/pulse/topic/${l().listing}`)}>
          Open listing
        </Button>
        <Show when={!mine()}>
          <Button size="sm" variant="ghost" onClick={() => void ask()}>
            <MessageSquarePlus size={12} /> Ask to join
          </Button>
        </Show>
      </div>
    </li>
  );
}

/** Publishes a Space into the directory. Owner only. */
export function PublishSpace(props: { space: string; name: string; canPublish: boolean }) {
  const [open, setOpen] = createSignal(false);
  const [category, setCategory] = createSignal("Technology");
  const [busy, setBusy] = createSignal(false);
  const [categories] = cachedResource(
    () => store.locked(),
    (locked) => (locked ? null : "space:categories"),
    (locked) => (locked ? Promise.resolve([]) : ipc.spacesCategories().catch(() => [])),
  );
  const publish = async () => {
    setBusy(true);
    try {
      await ipc.spacesPublish(props.space, category(), "");
      store.toast("Published. The listing is now travelling the network.");
      store.bump("spaces");
      setOpen(false);
    } catch (e) {
      store.toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Show when={props.canPublish}>
      <div class="flex flex-col gap-2 border-t border-border p-3">
        <Show
          when={open()}
          fallback={
            <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
              <Compass size={12} /> List this Space publicly
            </Button>
          }
        >
          <p class="text-xs text-muted">
            This publishes the name, your address and a category as a public event anyone can read and nobody can take back. The Space's messages,
            files and members stay private.
          </p>
          <div class="flex items-center gap-2">
            <Select
              value={category()}
              onChange={setCategory}
              aria-label="Category"
              options={(categories() ?? []).map((c) => ({ value: c, label: c }))}
            />
            <Button size="sm" loading={busy()} onClick={() => void publish()}>
              Publish
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </Show>
      </div>
    </Show>
  );
}
