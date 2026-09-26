// The verified badge.
//
// It is drawn from a chain read, never from a profile field. A profile can
// claim any transaction hash it likes; until the app has fetched that
// transaction and checked the sender, the recipient and the amount, nothing
// appears. An unverifiable claim is treated exactly like no claim — the one
// thing this must never do is show a tick because someone asked for one.
//
// The tooltip says what the badge means and links to the payment, so a
// reader can check it themselves instead of trusting this app's word.
import { Show, createMemo } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { BadgeCheck } from "lucide-solid";
import { ipc } from "~/lib/ipc";
import { store } from "~/lib/store";
import { cachedResource } from "~/lib/cache";

export interface VerifyStatus {
  address: string;
  claimed_tx: string;
  verified: boolean;
  reason: string;
  checked: boolean;
}

/** Reads and caches one account's badge state. */
export function useVerified(address: () => string | undefined) {
  const [res] = cachedResource(
    () => ({ a: address(), locked: store.locked() }),
    (k) => (k.a && !k.locked ? `verify:${k.a}` : null),
    async (k) => (k.a && !k.locked ? ((await ipc.verifyStatus(k.a).catch(() => null)) as VerifyStatus | null) : null),
  );
  return res;
}

/** The tick, when and only when the payment checks out. */
export function VerifiedBadge(props: { address?: string; size?: number; label?: boolean }) {
  const navigate = useNavigate();
  const st = useVerified(() => props.address);
  const ok = createMemo(() => st()?.verified === true);
  const tx = () => st()?.claimed_tx ?? "";
  return (
    <Show when={ok()}>
      <button
        type="button"
        class="inline-flex shrink-0 items-center gap-1 text-brand"
        title={`Verified: this account paid 100,000 HASH into the network's governance account. Click to read the payment (${tx().slice(0, 12)}…). It proves the payment, not who the person is.`}
        aria-label="Verified account"
        onClick={(e) => {
          e.stopPropagation();
          navigate("/network");
        }}
      >
        <BadgeCheck size={props.size ?? 14} />
        <Show when={props.label}>
          <span class="text-[11px]">Verified</span>
        </Show>
      </button>
    </Show>
  );
}
