// The network state in the top bar.
//
// It used to be a dot and a sentence that grew and shrank as the phase
// changed — "Syncing... Devices", "Syncing... Wallet" — so the whole
// header jittered while the app worked, which made an ordinary sync look
// like a fault. Now the width is fixed, the stage name is a quiet second
// line inside a tooltip, and progress is shown as motion rather than as
// changing text.
import { Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Check, Loader, Wifi, WifiOff } from "lucide-solid";
import { store, phaseKind } from "~/lib/store";
import { t } from "~/lib/i18n";
import { ipc } from "~/lib/ipc";

export function SyncIndicator() {
  const [now, setNow] = createSignal(Date.now());
  onMount(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(id));
  });

  const kind = createMemo(() => phaseKind(store.phase()));
  const peers = () => store.sync()?.peers ?? 0;

  /** One word. The detail lives in the tooltip, where it cannot jitter. */
  const word = createMemo(() => {
    switch (kind()) {
      case "idle":
        return "Synced";
      case "syncing":
        return "Syncing";
      case "connecting":
        return store.phase() === "Discovering" ? "Finding nodes" : "Connecting";
      case "backoff":
        return "Reconnecting";
      default:
        return "Offline";
    }
  });

  /** Everything the one word leaves out. */
  const detail = createMemo(() => {
    const p = store.phase();
    const s = store.sync();
    const lines: string[] = [];
    switch (kind()) {
      case "idle": {
        const ago = s?.last_ok_ms ? Math.max(0, Math.round((now() - s.last_ok_ms) / 1000)) : null;
        lines.push(ago === null ? "Up to date" : ago < 5 ? "Up to date, just now" : `Up to date, ${humanAgo(ago)} ago`);
        break;
      }
      case "syncing": {
        const stage = typeof p === "object" && "Syncing" in p ? p.Syncing : "";
        lines.push(stage ? `Catching up on ${stage.toLowerCase()}` : "Catching up");
        break;
      }
      case "connecting":
        lines.push("Looking for nodes to talk to");
        break;
      case "backoff": {
        const w = typeof p === "object" && "Backoff" in p ? p.Backoff.wait_secs : 0;
        lines.push(`No node answered. Trying again in ${w} s`);
        break;
      }
      default:
        lines.push(t("sync_offline"));
    }
    lines.push(`${peers()} node${peers() === 1 ? "" : "s"} connected`);
    if (s?.last_error) lines.push(s.last_error);
    lines.push(t("sync_now"));
    return lines.join("\n");
  });

  const busy = () => kind() === "syncing" || kind() === "connecting";
  const bad = () => kind() === "offline" || kind() === "backoff";

  return (
    <button
      type="button"
      class="group flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-fg"
      title={detail()}
      onClick={() => void ipc.syncNow().catch(() => undefined)}
      aria-label={`${word()}. ${detail().split("\n")[0]}`}
      data-sync={kind()}
    >
      <span class="relative flex h-3.5 w-3.5 items-center justify-center">
        <Show when={busy()} fallback={bad() ? <WifiOff size={12} /> : <Check size={12} class="text-brand" />}>
          <Loader size={12} class="animate-spin" />
        </Show>
      </span>
      {/* Fixed width: the label changes, the header does not move. */}
      <span class="w-[86px] truncate text-left tabular-nums">{word()}</span>
      <Show when={peers() > 0 && !busy()}>
        <span class="flex items-center gap-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100">
          <Wifi size={10} /> {peers()}
        </span>
      </Show>
    </button>
  );
}

function humanAgo(secs: number): string {
  if (secs < 60) return `${secs} s`;
  if (secs < 3600) return `${Math.round(secs / 60)} min`;
  return `${Math.round(secs / 3600)} h`;
}
