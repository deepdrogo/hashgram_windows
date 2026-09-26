// Who holds HASH and who runs the network. These used to sit in Explore,
// beside posts and people, which put a rich list in front of someone
// looking for a conversation. They are infrastructure, so they live in
// Network now — and both are read from the chain, not from a server.
import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Crown, Server, RefreshCw } from "lucide-solid";
import { Button, Badge, Card, Empty, Stat } from "~/components/ui";
import { ErrorState } from "~/components/States";
import { Mono, PersonAvatar } from "~/components/identity";
import { ipc, type Holders as HoldersData, type ProviderStatus } from "~/lib/ipc";
import { store } from "~/lib/store";
import { formatHash } from "~/lib/format";

// Walking the bank module is a few seconds of chain reads; once per session
// is enough unless the user asks again.
let holdersCache: HoldersData | null = null;

export function TopHolders() {
  const navigate = useNavigate();
  const [force, setForce] = createSignal(0);
  const [holders, { refetch }] = createResource(
    () => force(),
    async (f) => {
      if (holdersCache && f === 0) return holdersCache;
      const h = await ipc.networkHolders(100);
      holdersCache = h;
      return h;
    },
  );
  const me = () => store.status()?.address;
  const pct = (bps: number) => `${(bps / 100).toFixed(bps >= 1000 ? 1 : 2)}%`;
  return (
    <Card
      title="Holders"
      actions={
        <Button variant="ghost" size="icon-sm" title="Refresh" onClick={() => { holdersCache = null; setForce(force() + 1); void refetch(); }}>
          <RefreshCw size={13} />
        </Button>
      }
    >
      <p class="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted">
        <Crown size={13} /> Read from the chain's bank module, not from any server.
      </p>
      <Show when={!holders.error} fallback={<ErrorState error={holders.error} onRetry={() => void refetch()} />}>
        <Show when={holders()} fallback={<div class="p-3"><div class="skeleton h-9 w-full" /></div>}>
          {(h) => (
            <>
              <div class="grid grid-cols-3 gap-2 border-b border-border p-3">
                <Stat label="Accounts scanned" value={<span class="tnum">{h().accounts_scanned.toLocaleString()}</span>} sub={h().complete ? "complete" : "partial — the chain has more accounts than one scan covers"} />
                <Stat label="HASH in these accounts" value={<span class="tnum">{formatHash(h().total_uhash, 0, 2)}</span>} />
                <Stat label="Height" value={<span class="tnum">{h().height ?? "—"}</span>} />
              </div>
              <Show when={h().holders.length} fallback={<Empty title="No balances found" />}>
                <ol class="max-h-96 divide-y divide-border overflow-auto">
                  <For each={h().holders}>
                    {(x) => (
                      <li class={`flex items-center gap-3 px-3 py-2 text-[13px] ${x.address === me() ? "bg-surface-2" : ""}`}>
                        <span class="tnum w-8 text-right text-xs text-muted">#{x.rank}</span>
                        <button type="button" onClick={() => navigate(`/profile/${x.address}`)} title="Open profile">
                          <PersonAvatar address={x.address} size={24} />
                        </button>
                        <span class="min-w-0 flex-1">
                          <Show when={x.username} fallback={<Mono text={x.address} head={12} tail={6} copy />}>
                            <button type="button" class="font-medium hover:underline" onClick={() => navigate(`/profile/${x.address}`)}>@{x.username}</button>
                            <span class="block"><Mono text={x.address} head={12} tail={6} copy class="text-[11px] text-muted" /></span>
                          </Show>
                        </span>
                        <span class="text-right">
                          <span class="tnum block font-medium">{formatHash(x.balance_uhash, 2, 2)} HASH</span>
                          <span class="tnum block text-[11px] text-muted">{pct(x.share_bps)} of scanned</span>
                        </span>
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </Card>
  );
}

export function Providers() {
  const [list, { refetch }] = createResource(() => ipc.networkProviders());
  const sorted = createMemo(() => [...(list() ?? [])].sort((a, b) => (BigInt(b.bond_uhash || "0") > BigInt(a.bond_uhash || "0") ? 1 : -1)));
  const roles = (p: ProviderStatus) => p.roles.map((r) => r.replace(/^ROLE_/, "").toLowerCase()).join(", ");
  return (
    <Card
      title="Providers"
      actions={
        <Button variant="ghost" size="icon-sm" title="Refresh" onClick={() => void refetch()}>
          <RefreshCw size={13} />
        </Button>
      }
    >
      <p class="flex items-center gap-2 border-b border-border px-3 py-2 text-xs text-muted">
        <Server size={13} /> Registered storage and relay providers, by bond. Every node you read from is run by one of these operators.
      </p>
      <Show when={!list.error} fallback={<ErrorState error={list.error} onRetry={() => void refetch()} />}>
        <Show when={list()} fallback={<div class="p-3"><div class="skeleton h-9 w-full" /></div>}>
          <Show when={sorted().length} fallback={<Empty title="No providers registered yet" />}>
            <ol class="max-h-96 divide-y divide-border overflow-auto">
              <For each={sorted()}>
                {(p, i) => (
                  <li class="flex items-center gap-3 px-3 py-2 text-[13px]">
                    <span class="tnum w-6 text-right text-xs text-muted">{i() + 1}</span>
                    <span class="min-w-0 flex-1">
                      <span class="flex items-center gap-2">
                        <span class="truncate font-medium">{p.moniker || "unnamed"}</span>
                        <Badge>{roles(p) || "provider"}</Badge>
                        <Show when={p.jailed}><Badge>jailed</Badge></Show>
                      </span>
                      <Mono text={p.operator} head={12} tail={6} copy class="text-[11px] text-muted" />
                    </span>
                    <span class="text-right">
                      <span class="tnum block font-medium">{formatHash(p.bond_uhash, 0, 2)} HASH</span>
                      <span class="tnum block text-[11px] text-muted">{p.declared_storage_bytes ? `${(p.declared_storage_bytes / 1e9).toFixed(0)} GB declared` : "relay only"}</span>
                    </span>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </Show>
      </Show>
    </Card>
  );
}
