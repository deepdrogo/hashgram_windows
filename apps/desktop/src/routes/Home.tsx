import { createResource, Show, For } from "solid-js";
import { A } from "@solidjs/router";
import { Card, Stat, Skeleton, Notice } from "~/components/ui";
import { Mono, VerifiedBy } from "~/components/identity";
import { ipc, pick, str, num } from "~/lib/ipc";
import { formatHash, formatUhash, relTime, verificationLabel } from "~/lib/format";
import { store } from "~/lib/store";

export function Home() {
  const [wallet] = createResource(async () => {
    try {
      return { ok: await ipc.walletOverview(), error: null as string | null };
    } catch (e) {
      return { ok: null, error: String(e) };
    }
  });
  const [epoch] = createResource(() => ipc.chainGet("hashgram/serviceproof/v1/epoch/current").catch(() => null));
  const [recent] = createResource(() => ipc.txRecent().catch(() => []));
  const net = store.net;

  return (
    <div class="page flex flex-col gap-4">
      <div class="flex items-baseline justify-between">
        <h1 class="page-title">Home</h1>
        <Show when={store.status()?.address}>
          <Mono text={store.status()!.address!} copy class="text-xs text-muted" />
        </Show>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <Show when={wallet()} fallback={<div class="stat"><Skeleton lines={2} /></div>}>
          {(w) => (
            <Show
              when={w().ok}
              fallback={
                <div class="stat">
                  <span class="stat-label">Balance</span>
                  <span class="text-xs text-muted">{w().error}</span>
                </div>
              }
            >
              {(o) => (
                <Stat
                  label="Balance"
                  value={<span title={formatUhash(o().balance_uhash)}>{formatHash(o().balance_uhash)} HASH</span>}
                  sub={<VerifiedBy verification={o().verification} source={o().source} />}
                />
              )}
            </Show>
          )}
        </Show>
        <Stat
          label="Network"
          mono={false}
          value={`${net()?.verified ?? 0} nodes`}
          sub={net()?.last_read ? verificationLabel(net()!.last_read) : "no chain read yet"}
        />
        <Stat
          label="Current epoch"
          value={epoch() ? str(pick(epoch()!.value, "epoch.number"), "—") : "—"}
          sub={epoch() ? `blocks ${str(pick(epoch()!.value, "epoch.start_height"))}–${str(pick(epoch()!.value, "epoch.end_height"))}` : "waiting for a chain source"}
        />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <Card title="Recent transactions" actions={<A href="/wallet/history" class="text-xs text-muted hover:text-fg">All</A>}>
          <Show when={recent()} fallback={<div class="p-4"><Skeleton lines={3} /></div>}>
            <Show when={recent()!.length} fallback={<p class="p-4 text-xs text-muted">Nothing sent from this PC yet.</p>}>
              <ul>
                <For each={recent()!.slice(0, 6)}>
                  {(r) => (
                    <li class="flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-sm last:border-0">
                      <span class="truncate">{r.summary}</span>
                      <span class="mono shrink-0 text-xs text-muted">
                        {r.state}
                        {r.height ? ` · ${num(r.height)}` : ""} · {relTime(r.submitted)}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </Card>
        <Card title="Messages and feed">
          <div class="p-4">
            <Notice>Messages, feed, reels, channels and calls arrive in Stage 2 of this build. Wallet, identity, staking, governance, usernames, founder and network are live now.</Notice>
          </div>
        </Card>
      </div>
    </div>
  );
}
