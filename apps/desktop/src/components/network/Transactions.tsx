// The network's transactions, for anyone to read.
//
// A chain that nobody can look at is just a database with extra steps, so
// this page is deliberately plain: newest first, one row per transaction,
// a single search box that takes a hash, an account or a memo.
//
// Where the data comes from is stated on the page. Recent transactions and
// account history come from an indexer — a read model over the chain that
// anyone can run, and which this app will not pretend is an authority. A
// hash lookup also works with no indexer at all, because the app can ask
// the chain directly through the P2P relay. When neither can answer, the
// page says so rather than showing an empty table that looks like "no
// transactions exist".
import { For, Show, createMemo, createSignal } from "solid-js";
import { Search, X, Receipt, ExternalLink } from "lucide-solid";
import { Button, Card, Input, Badge, Skeleton, Notice } from "~/components/ui";
import { Mono } from "~/components/identity";
import { ipc } from "~/lib/ipc";
import { store } from "~/lib/store";
import { cachedResource } from "~/lib/cache";
import { formatHash } from "~/lib/format";
import { pick, str, arr, num } from "~/lib/chain";

const HASH_RE = /^[0-9a-fA-F]{64}$/;

/** What the typed term is, so the right query runs without a mode switch. */
function kindOf(term: string): "empty" | "hash" | "address" | "text" {
  const q = term.trim();
  if (!q) return "empty";
  if (HASH_RE.test(q)) return "hash";
  if (q.startsWith("hash1")) return "address";
  return "text";
}

/** Shortens a message type: /hashgram.bank.v1.MsgSend -> MsgSend. */
function msgLabel(types: unknown): string {
  const list = arr(types).map((t) => str(t).split(".").pop() ?? "");
  if (!list.length) return "—";
  return list.length > 1 ? `${list[0]} +${list.length - 1}` : (list[0] ?? "—");
}

export function Transactions() {
  const [term, setTerm] = createSignal("");
  const [applied, setApplied] = createSignal("");
  const kind = createMemo(() => kindOf(applied()));

  // The list: recent, or one account's history when an address is searched.
  const [list] = cachedResource(
    () => ({ q: applied(), k: kind(), tick: store.ticks().network, locked: store.locked() }),
    (k) => (k.locked || k.k === "hash" ? null : `txs:${k.k}:${k.q}`),
    async (k) => {
      if (k.locked || k.k === "hash") return null;
      return ipc
        .networkTransactions({
          address: k.k === "address" ? k.q.trim() : undefined,
          q: k.k === "text" ? k.q.trim() : undefined,
          limit: 50,
        })
        .catch(() => null);
    },
  );

  // A hash gets its own lookup, which also works without an indexer.
  const [one] = cachedResource(
    () => ({ q: applied(), k: kind(), locked: store.locked() }),
    (k) => (k.k === "hash" && !k.locked ? `tx:${k.q.toUpperCase()}` : null),
    async (k) => (k.k === "hash" && !k.locked ? ipc.networkTransaction(k.q.trim()).catch(() => null) : null),
  );

  const rows = createMemo(() => {
    if (kind() === "hash") {
      const v = one();
      return v ? [v] : [];
    }
    const v = list();
    return arr(pick(v, "rows") ?? pick(v, "items") ?? v);
  });
  const loading = () => (kind() === "hash" ? one.loading : list.loading);
  const answered = () => (kind() === "hash" ? one() !== undefined : list() !== undefined && list() !== null);

  const search = () => {
    const q = term().trim();
    if (q && kindOf(q) === "text" && q.length < 2) {
      store.toast("Type at least two characters, an address or a full hash", "error");
      return;
    }
    setApplied(q);
  };
  const clear = () => {
    setTerm("");
    setApplied("");
  };

  return (
    <Card
      title="Transactions"
      actions={
        <span class="text-[11px] text-muted">
          {kind() === "hash" ? "hash lookup: indexer, then the chain" : "recent activity from the indexers you configured"}
        </span>
      }
    >
      {/* Deliberately not a form element: in a webview a submit navigates
          the document, which tears the app down and reloads it. Enter is
          handled on the input instead. */}
      <div class="flex items-center gap-2 border-b border-border p-3">
        <Input
          class="flex-1"
          value={term()}
          onInput={(e) => setTerm(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") search();
          }}
          placeholder="Transaction hash, hash1… account, or a memo"
          aria-label="Search transactions"
          spellcheck={false}
        />
        <Button size="sm" variant="secondary" onClick={search}>
          <Search size={12} /> Search
        </Button>
        <Show when={applied()}>
          <Button size="sm" variant="ghost" onClick={clear} aria-label="Clear search">
            <X size={12} />
          </Button>
        </Show>
      </div>

      <Show when={applied()}>
        <p class="border-b border-border px-3 py-2 text-[11px] text-muted">
          {kind() === "hash"
            ? "One transaction by hash."
            : kind() === "address"
              ? "Everything this account signed, sent or received."
              : "Transactions whose hash starts with, or whose memo contains, this text."}
        </p>
      </Show>

      <Show when={store.locked()}>
        <p class="p-4 text-xs text-muted">Unlock to read the chain.</p>
      </Show>

      <Show when={!store.locked()}>
        <Show when={!loading() || rows().length} fallback={<div class="p-3"><Skeleton lines={5} /></div>}>
          <Show
            when={rows().length}
            fallback={
              <div class="p-4">
                <Show
                  when={answered()}
                  fallback={
                    <Notice title="No indexer answered">
                      Recent transactions are read from a public indexer. None is configured or reachable — add one in Settings → Network. A full
                      transaction hash can still be looked up here without one.
                    </Notice>
                  }
                >
                  <p class="text-xs text-muted">{applied() ? "Nothing matched." : "The indexer returned no transactions."}</p>
                </Show>
              </div>
            }
          >
            <table class="table">
              <thead>
                <tr>
                  <th>Hash</th>
                  <th>Height</th>
                  <th>Type</th>
                  <th>Signer</th>
                  <th class="text-right">Fee</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(r) => {
                    const code = num(pick(r, "code")) ?? 0;
                    return (
                      <tr>
                        <td>
                          <Mono text={str(pick(r, "hash"))} head={10} tail={6} copy />
                        </td>
                        <td class="tnum">{num(pick(r, "height"))?.toLocaleString() ?? "—"}</td>
                        <td class="text-xs">{msgLabel(pick(r, "msg_types"))}</td>
                        <td>
                          <Show when={arr(pick(r, "signers")).length} fallback={<span class="text-xs text-muted">—</span>}>
                            <Mono text={str(arr(pick(r, "signers"))[0])} head={12} tail={4} copy />
                          </Show>
                        </td>
                        <td class="tnum text-right">{formatHash(str(pick(r, "fee_uhash"), "0"))}</td>
                        <td>
                          <Show when={code === 0} fallback={<Badge title={str(pick(r, "raw_log")) || `code ${code}`}>failed</Badge>}>
                            <Badge brand>ok</Badge>
                          </Show>
                        </td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
            <Show when={rows().some((r) => str(pick(r, "memo")))}>
              <ul class="border-t border-border px-3 py-2 text-[11px] text-muted">
                <For each={rows().filter((r) => str(pick(r, "memo")))}>
                  {(r) => (
                    <li class="truncate">
                      <Mono text={str(pick(r, "hash"))} head={8} tail={4} /> <span class="selectable">{str(pick(r, "memo"))}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </Show>
      </Show>

      <p class="flex items-center gap-1 border-t border-border px-3 py-2 text-[11px] text-muted">
        <Receipt size={11} /> Every transaction here is on the public chain and can be checked against any node. A memo is public too — it is not a
        private note.
        <Show when={store.status()?.address}>
          {(me) => (
            <button type="button" class="ml-auto inline-flex items-center gap-1 hover:text-fg" onClick={() => { setTerm(me()); setApplied(me()); }}>
              <ExternalLink size={11} /> My transactions
            </button>
          )}
        </Show>
      </p>
    </Card>
  );
}

export const __test = { kindOf, msgLabel };
