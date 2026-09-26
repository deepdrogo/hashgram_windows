// Who follows somebody, and who they follow.
//
// "Following" is read from the person's own signed events, so it works
// offline and needs nothing central. "Followers" is the reverse direction,
// which only an index over everybody's events can answer; without one the
// list says so rather than pretending the answer is zero.
import { For, Show, createResource } from "solid-js";
import { Button, Empty, Notice, Skeleton } from "~/components/ui";
import { PersonAvatar, Who } from "~/components/identity";
import { ipc } from "~/lib/ipc";
import { store } from "~/lib/store";

export function FollowList(props: { address: string; which: "followers" | "following"; onOpen: (address: string) => void }) {
  const [rows] = createResource(
    () => ({ a: props.address, w: props.which }),
    (k) => ipc.profileFollowList(k.a, k.w).catch(() => [] as string[]),
  );
  const indexed = () => !!store.settings()?.network.indexer_url;

  return (
    <div class="flex max-h-[60vh] flex-col gap-2 overflow-auto">
      <Show when={props.which === "followers" && !indexed()}>
        <Notice title="Followers cannot be counted from here">
          Nothing an account signs records who followed them, so this list needs an indexer. Add one in Settings → Network, or run your own.
        </Notice>
      </Show>
      <Show when={rows.loading}>
        <Skeleton lines={3} />
      </Show>
      <Show when={rows() && !rows()!.length && !(props.which === "followers" && !indexed())}>
        <Empty title={props.which === "followers" ? "No followers yet" : "Not following anyone yet"} />
      </Show>
      <For each={rows() ?? []}>
        {(address) => (
          <div class="row flex items-center gap-3 rounded-md px-2 py-1.5">
            <PersonAvatar address={address} size={28} />
            <Who address={address} class="min-w-0 flex-1" />
            <Button size="sm" variant="secondary" onClick={() => props.onOpen(address)}>
              Profile
            </Button>
          </div>
        )}
      </For>
    </div>
  );
}
