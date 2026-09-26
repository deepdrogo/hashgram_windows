// The right-hand column of Pulse: what is busy on the network right now.
//
// Everything here is a count over signed events that the answering node
// computed and this client can recompute — there is no ranking service and
// nothing is personalised behind the user's back. Holders and providers are
// infrastructure, not social discovery, and live in Network instead.
import { For, Show, createResource } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Hash, Megaphone, Users, LayoutGrid } from "lucide-solid";
import { Skeleton } from "~/components/ui";
import { PersonAvatar, Who } from "~/components/identity";
import { ipc, type Digest, type SpaceSummary } from "~/lib/ipc";
import { store } from "~/lib/store";

export function DiscoveryRail() {
  const navigate = useNavigate();
  const [digest] = createResource(
    () => ({ tick: store.ticks().feed, locked: store.locked() }),
    (k) => (k.locked ? Promise.resolve(null) : ipc.hashwallDigest(7 * 24 * 3600, 6).catch(() => null as Digest | null)),
  );
  const [spaces] = createResource(
    () => ({ tick: store.ticks().spaces, locked: store.locked() }),
    (k) => (k.locked ? Promise.resolve([]) : ipc.spacesList().catch(() => [] as SpaceSummary[])),
  );

  return (
    <aside class="hidden w-[288px] shrink-0 overflow-y-auto border-l border-border px-3 py-3 lg:block" aria-label="Discover">
      <Show when={digest.loading && !digest()}>
        <Skeleton lines={6} />
      </Show>

      <Section title="Trending topics" icon={<Megaphone size={13} />}>
        <Show when={digest()?.walls?.length} fallback={<Quiet>No topic has been active this week.</Quiet>}>
          <For each={digest()!.walls.slice(0, 5)}>
            {(w) => (
              <Row onClick={() => navigate(`/topics/${w.id}`)}>
                <span class="min-w-0 flex-1 truncate">{w.name}</span>
                <span class="tnum text-xs text-muted">{w.posts}</span>
              </Row>
            )}
          </For>
        </Show>
      </Section>

      <Section title="Popular hashtags" icon={<Hash size={13} />}>
        <Show when={digest()?.top_hashtags?.length} fallback={<Quiet>Nothing is trending yet.</Quiet>}>
          <For each={digest()!.top_hashtags.slice(0, 6)}>
            {(h) => (
              <Row onClick={() => navigate(`/pulse/tag/${encodeURIComponent(h.tag)}`)}>
                <span class="min-w-0 flex-1 truncate">#{h.tag}</span>
                <span class="tnum text-xs text-muted">{h.posts}</span>
              </Row>
            )}
          </For>
        </Show>
      </Section>

      <Section title="People to follow" icon={<Users size={13} />}>
        <Show when={digest()?.top_authors?.length} fallback={<Quiet>Nobody has posted near this node yet.</Quiet>}>
          <For each={digest()!.top_authors.slice(0, 5)}>
            {(a) => (
              <Row onClick={() => navigate(`/profile/${a.author}`)}>
                <PersonAvatar address={a.author} size={22} />
                <Who address={a.author} class="min-w-0 flex-1" size="sm" />
                <span class="tnum text-xs text-muted" title={`${a.posts} posts this week`}>
                  {a.posts}
                </span>
              </Row>
            )}
          </For>
        </Show>
      </Section>

      <Section title="Your Spaces" icon={<LayoutGrid size={13} />}>
        <Show when={spaces()?.length} fallback={<Quiet>You are not in a Space yet.</Quiet>}>
          <For each={(spaces() ?? []).slice(0, 4)}>
            {(s) => (
              <Row onClick={() => navigate(`/spaces/${s.id}`)}>
                <span class="min-w-0 flex-1 truncate">{s.name}</span>
                <span class="tnum text-xs text-muted">{s.members}</span>
              </Row>
            )}
          </For>
        </Show>
      </Section>

      <Show when={digest()}>
        {(d) => (
          <p class="mt-3 px-1 text-[11px] leading-relaxed text-muted">
            <Show when={!d().note} fallback={<>Counted on this device: {d().note}</>}>
              {d().authors} people, {d().events} events in the last week, as one node sees it.
            </Show>
          </p>
        )}
      </Show>
    </aside>
  );
}

function Section(props: { title: string; icon: unknown; children: unknown }) {
  return (
    <section class="mb-4">
      <h2 class="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {props.icon as never}
        {props.title}
      </h2>
      <div class="space-y-px">{props.children as never}</div>
    </section>
  );
}

function Row(props: { onClick: () => void; children: unknown }) {
  return (
    <button type="button" class="row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2" onClick={props.onClick}>
      {props.children as never}
    </button>
  );
}

function Quiet(props: { children: unknown }) {
  return <p class="px-2 py-1 text-xs text-muted">{props.children as never}</p>;
}
