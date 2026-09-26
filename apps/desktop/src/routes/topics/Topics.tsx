// Topics: subject pages people gather around — a film, an election, a
// city, a language. In the protocol these are channels (CHANNEL_CREATE);
// "Topic" is what the product calls them, in one place, everywhere.
import { For, Show, createResource, createSignal } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Plus, Search } from "lucide-solid";
import { Button, Empty, Input, Skeleton } from "~/components/ui";
import { ipc, type WallInfo } from "~/lib/ipc";
import { store } from "~/lib/store";
import { WallCard, WallView, CreateWallDialog, ComposeDialog } from "~/routes/feed/Feed";

/** The Topics tab inside Pulse: pinned topics, plus what is active now. */
export function TopicsHome() {
  const navigate = useNavigate();
  const [create, setCreate] = createSignal(false);
  const [open, setOpen] = createSignal("");
  const [pinned, { refetch }] = createResource(
    () => ({ tick: store.ticks().feed, locked: store.locked() }),
    (k) => (k.locked ? Promise.resolve([] as WallInfo[]) : ipc.wallsPinned().catch(() => [] as WallInfo[])),
  );
  const [active] = createResource(
    () => ({ tick: store.ticks().feed, locked: store.locked() }),
    (k) => (k.locked ? Promise.resolve(null) : ipc.hashwallDigest(7 * 24 * 3600, 20).catch(() => null)),
  );

  const openById = () => {
    const m = open().trim().toLowerCase().match(/[0-9a-f]{64}/);
    if (m) navigate(`/topics/${m[0]}`);
    else store.toast("That is not a topic id or link", "error");
  };

  const unpinned = () => {
    const have = new Set((pinned() ?? []).map((w) => w.id));
    return (active()?.walls ?? []).filter((w) => !have.has(w.id));
  };

  return (
    <>
      <div class="mb-3 flex items-center gap-2">
        <div class="relative flex-1">
          <Search size={13} class="pointer-events-none absolute left-2 top-2 text-muted" />
          <Input class="h-7 pl-7" placeholder="Open a topic by id or link…" value={open()} onInput={(e) => setOpen(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && openById()} />
        </div>
        <Button size="sm" variant="brand" onClick={() => setCreate(true)}>
          <Plus size={13} /> New topic
        </Button>
      </div>

      <Show when={pinned.loading && !pinned()}>
        <Skeleton lines={3} />
      </Show>

      <Show when={(pinned() ?? []).length}>
        <h2 class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Pinned</h2>
        <For each={pinned() ?? []}>{(w) => <WallCard w={w} onOpen={() => navigate(`/topics/${w.id}`)} />}</For>
      </Show>

      <Show when={unpinned().length}>
        <h2 class="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Active this week</h2>
        <For each={unpinned()}>{(w) => <WallCard w={w} onOpen={() => navigate(`/topics/${w.id}`)} />}</For>
      </Show>

      <Show when={!pinned.loading && !(pinned() ?? []).length && !unpinned().length}>
        <Empty title="No topics yet">Start one for a subject, an event or a place. Anyone can open it and, if you leave it open, post on it.</Empty>
      </Show>

      <CreateWallDialog open={create()} onClose={() => { setCreate(false); void refetch(); }} onCreated={(w) => navigate(`/topics/${w.id}`)} />
    </>
  );
}

/** One topic: /topics/<id>. */
export function TopicRoute() {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [compose, setCompose] = createSignal(false);
  return (
    <div class="flex h-full flex-col">
      <Show when={params.id} fallback={<div class="mx-auto w-full max-w-2xl px-4 py-3"><TopicsHome /></div>}>
        {(id) => (
          <>
            <WallView id={id()} onBack={() => navigate("/pulse/topics")} onCompose={() => setCompose(true)} />
            <ComposeDialog open={compose()} onClose={() => setCompose(false)} defaultWall={id()} />
          </>
        )}
      </Show>
    </div>
  );
}
