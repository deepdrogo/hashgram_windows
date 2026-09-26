// Network → Your Node.
//
// Running a node used to mean a console window appearing and the app
// saying "running" because an HTTP port answered. This shows what the app
// actually knows: a process id it owns, a state derived from evidence, the
// checks that must pass before it starts, and the node's own output in a
// panel instead of a log file on disk.
import { For, Show, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { Play, Square, FolderOpen, ScrollText, RefreshCw, Check, X, AlertTriangle } from "lucide-solid";
import { Button, Badge, Card, Dialog, Notice, Stat } from "~/components/ui";
import { Mono } from "~/components/identity";
import { ipc, errText, type NodeStatus, type NodeCheck, type NodeState } from "~/lib/ipc";
import { store } from "~/lib/store";
import { formatBytes } from "~/lib/format";

/** The one-word state, and what it means, in the user's language. */
const WORDS: Record<NodeState, { label: string; tone: "ok" | "warn" | "bad" | "off"; say: string }> = {
  not_installed: { label: "Not installed", tone: "off", say: "This build does not ship a node program." },
  stopped: { label: "Stopped", tone: "off", say: "Nothing is running." },
  starting: { label: "Starting", tone: "warn", say: "The node was launched and has not answered yet." },
  connecting: { label: "Connecting", tone: "warn", say: "It is answering but has met no peers yet." },
  syncing: { label: "Syncing", tone: "warn", say: "It has peers and is catching up with the chain." },
  running: { label: "Running", tone: "ok", say: "Peered and caught up." },
  degraded: { label: "Degraded", tone: "warn", say: "Running, but something is wrong." },
  stopping: { label: "Stopping", tone: "warn", say: "Winding down." },
  crashed: { label: "Crashed", tone: "bad", say: "The process ended on its own." },
  error: { label: "Could not start", tone: "bad", say: "" },
};

export function YourNode() {
  const [busy, setBusy] = createSignal<"start" | "stop" | null>(null);
  const [logs, setLogs] = createSignal(false);
  const [tick, setTick] = createSignal(0);

  onMount(() => {
    const t = setInterval(() => setTick((n) => n + 1), 3000);
    onCleanup(() => clearInterval(t));
  });

  const [status, { refetch }] = createResource(
    () => ({ t: tick(), locked: store.locked() }),
    (k) => (k.locked ? Promise.resolve(null) : ipc.nodeStatus().catch(() => null)),
  );
  const [checks, { refetch: recheck }] = createResource(
    () => (store.locked() ? null : tick() === 0 || undefined),
    () => ipc.nodePreflight().catch(() => [] as NodeCheck[]),
  );

  const word = () => WORDS[status()?.state ?? "stopped"];
  const blockers = () => (checks() ?? []).filter((c) => c.blocking && !c.ok);

  const act = async (what: "start" | "stop") => {
    setBusy(what);
    try {
      if (what === "start") {
        const pid = await ipc.nodeStart();
        store.toast(`Node started (process ${pid})`);
      } else {
        await ipc.nodeStop();
        store.toast("Node stopped");
      }
      await refetch();
      await recheck();
    } catch (e) {
      store.toast(errText(e), "error");
      await recheck();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title="Your node"
      actions={
        <Show when={status()}>
          {(s) => (
            <span class="flex items-center gap-2 text-xs">
              <span class={`dot dot-${word().tone}`} aria-hidden="true" />
              <span class="font-medium">{word().label}</span>
              <Show when={s().pid}>
                <span class="text-muted">process {s().pid}</span>
              </Show>
            </span>
          )}
        </Show>
      }
    >
      <Show when={status()} fallback={<p class="p-4 text-xs text-muted">Unlock to see whether a node is running.</p>}>
        {(s) => (
          <div class="flex flex-col gap-3 p-4">
            <p class="text-xs text-muted">{s().message || word().say}</p>

            <Show when={s().state === "running" || s().state === "syncing" || s().state === "connecting" || s().state === "degraded"}>
              <div class="grid grid-cols-4 gap-3">
                <Stat label="Uptime" value={<span class="tnum">{humanSecs(s().uptime_secs)}</span>} />
                <Stat label="Peers" value={<span class="tnum">{s().peers}</span>} sub={s().roles.join(", ") || "roles unknown"} />
                <Stat label="Height" value={<span class="tnum">{s().height ? s().height.toLocaleString() : "—"}</span>} />
                <Stat
                  label="Storage"
                  value={<span class="tnum">{s().storage_quota ? formatBytes(s().storage_used) : "—"}</span>}
                  sub={s().storage_quota ? `of ${formatBytes(s().storage_quota)} offered` : "not reported"}
                />
              </div>
              <Show when={s().peer_id}>
                <p class="text-xs text-muted">
                  Peer id <Mono text={s().peer_id} head={14} tail={8} copy />
                </p>
              </Show>
              <Show when={s().version}>
                <p class="text-xs text-muted">Version {s().version}</p>
              </Show>
            </Show>

            <Show when={s().restarts > 0}>
              <Notice>
                The node has ended by itself {s().restarts} time{s().restarts === 1 ? "" : "s"} since this app started.
                The log below says why.
              </Notice>
            </Show>

            <Show when={blockers().length}>
              <div class="rounded-md border border-border p-3">
                <p class="mb-2 flex items-center gap-1.5 text-xs font-medium">
                  <AlertTriangle size={13} /> Before it can start
                </p>
                <ul class="space-y-1">
                  <For each={checks() ?? []}>
                    {(c) => (
                      <li class="flex items-start gap-2 text-xs">
                        <Show when={c.ok} fallback={<X size={12} class="mt-0.5 shrink-0" />}>
                          <Check size={12} class="mt-0.5 shrink-0 text-brand" />
                        </Show>
                        <span class="font-medium">{c.name}</span>
                        <span class="min-w-0 flex-1 text-muted">{c.detail}</span>
                        <Show when={!c.ok && !c.blocking}>
                          <Badge>advisory</Badge>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>

            <div class="flex flex-wrap items-center gap-2">
              <Show
                when={s().pid}
                fallback={
                  <Button size="sm" variant="brand" loading={busy() === "start"} disabled={!s().configured || !s().installed} onClick={() => void act("start")}>
                    <Play size={13} /> Start node
                  </Button>
                }
              >
                <Button size="sm" variant="secondary" loading={busy() === "stop"} onClick={() => void act("stop")}>
                  <Square size={13} /> Stop node
                </Button>
                <Button size="sm" variant="ghost" loading={busy() === "start"} onClick={async () => { await act("stop"); await act("start"); }}>
                  <RefreshCw size={13} /> Restart
                </Button>
              </Show>
              <Button size="sm" variant="ghost" onClick={() => void ipc.nodeOpenFolder().catch((e) => store.toast(errText(e), "error"))}>
                <FolderOpen size={13} /> Data folder
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setLogs(true)}>
                <ScrollText size={13} /> View logs
              </Button>
              <Show when={!s().configured}>
                <span class="text-xs text-muted">Set the node up in Earn first.</span>
              </Show>
              <Show when={s().starts_at_logon}>
                <Badge title="A logon task also starts it when you sign in to Windows">starts at logon</Badge>
              </Show>
            </div>
            <p class="text-[11px] text-muted">
              No console window opens: the app runs the node as a child process and captures its output. {s().home}
            </p>
          </div>
        )}
      </Show>
      <LogViewer open={logs()} onClose={() => setLogs(false)} />
    </Card>
  );
}

function LogViewer(props: { open: boolean; onClose: () => void }) {
  const [tick, setTick] = createSignal(0);
  const [lines] = createResource(
    () => (props.open ? tick() : null),
    () => ipc.nodeLogs().catch(() => [] as string[]),
  );
  onMount(() => {
    const t = setInterval(() => props.open && setTick((n) => n + 1), 2000);
    onCleanup(() => clearInterval(t));
  });
  return (
    <Dialog open={props.open} onClose={props.onClose} title="Node log" width="max-w-3xl">
      <p class="mb-2 text-xs text-muted">
        What the node printed since this app started it. Keys, mnemonics and message contents are never logged.
      </p>
      <pre class="mono max-h-[60vh] overflow-auto rounded-md border border-border bg-surface-2 p-3 text-[11px] selectable">
        {(lines() ?? []).join("\n") || "Nothing yet."}
      </pre>
    </Dialog>
  );
}

function humanSecs(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}
