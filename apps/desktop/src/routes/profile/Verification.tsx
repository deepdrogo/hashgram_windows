// Buying the verified badge.
//
// The panel is written to be talked out of. It states the price, where the
// money goes, what the badge does and does not prove, and that the payment
// is final, before it will take a confirmation. A 100,000 HASH decision
// should not be one click away from a curious user.
//
// The badge is not granted by us and cannot be taken away by us: it is a
// public payment plus a claim in the profile, and every reader re-checks
// both against the chain. See apps/desktop/src-tauri/src/cmd_verify.rs.
import { Show, createSignal } from "solid-js";
import { BadgeCheck, TriangleAlert } from "lucide-solid";
import { Button, Input, Notice } from "~/components/ui";
import { Mono } from "~/components/identity";
import { ipc, errText } from "~/lib/ipc";
import { store } from "~/lib/store";
import { cachedResource, forget } from "~/lib/cache";
import { useVerified, type VerifyStatus } from "~/components/social/Verified";

export function VerificationPanel() {
  const me = () => store.status()?.address ?? undefined;
  const status = useVerified(me);
  const [open, setOpen] = createSignal(false);
  const [confirm, setConfirm] = createSignal("");
  const [recover, setRecover] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const [terms] = cachedResource(
    () => store.locked(),
    (locked) => (locked ? null : "verify:terms"),
    (locked) => (locked ? Promise.resolve(null) : ipc.verifyTerms().catch(() => null)),
  );

  const refresh = () => {
    const a = me();
    if (a) forget(`verify:${a}`);
    store.bump("feed");
  };

  const buy = async () => {
    setBusy(true);
    try {
      const r = (await ipc.verifyPurchase(confirm())) as VerifyStatus;
      refresh();
      setOpen(false);
      setConfirm("");
      store.toast(r.verified ? "Verified. The payment is on the chain." : "Paid. The badge appears once the payment is in a block.");
    } catch (e) {
      store.toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const record = async () => {
    setBusy(true);
    try {
      await ipc.verifyRecord(recover());
      refresh();
      setRecover("");
      store.toast("Payment recorded");
    } catch (e) {
      store.toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="card mt-4 p-3">
      <Show
        when={!status()?.verified}
        fallback={
          <div class="flex items-start gap-2">
            <BadgeCheck size={16} class="mt-0.5 shrink-0 text-brand" />
            <div class="min-w-0 text-[13px]">
              <p class="font-medium">This account is verified</p>
              <p class="mt-0.5 text-xs text-muted">
                Backed by <Mono text={status()?.claimed_tx ?? ""} head={10} tail={6} copy /> — a public payment of 100,000 HASH. Anyone can check it,
                and nobody can revoke it.
              </p>
            </div>
          </div>
        }
      >
        <div class="flex items-start gap-2">
          <BadgeCheck size={16} class="mt-0.5 shrink-0 text-muted" />
          <div class="min-w-0 flex-1">
            <p class="text-[13px] font-medium">Verified badge</p>
            <p class="mt-0.5 text-xs text-muted">
              A badge here is a public payment of <span class="tnum">100,000 HASH</span> into the account governance spends from — not to the founder,
              not to us. Every reader re-checks that payment on the chain, so the badge cannot be given, sold or withdrawn by anyone.
            </p>
            <p class="mt-1 text-xs text-muted">
              It proves that whoever controls this account paid. It is <em>not</em> an identity check, and this app will never claim it is.
            </p>

            <Show when={status()?.claimed_tx && !status()?.verified}>
              <Notice class="mt-2">
                This profile claims a payment that did not check out{status()?.reason ? `: ${status()?.reason}` : ""}. No badge is shown.
              </Notice>
            </Show>

            <Show
              when={open()}
              fallback={
                <div class="mt-2 flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setOpen(true)} disabled={!terms()?.destination}>
                    Buy for 100,000 HASH
                  </Button>
                  <Show when={terms() && !terms()?.destination}>
                    <span class="text-[11px] text-muted">No node answered, so the destination cannot be confirmed. Try again when connected.</span>
                  </Show>
                </div>
              }
            >
              <div class="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                <p class="flex items-start gap-1.5 text-xs">
                  <TriangleAlert size={13} class="mt-0.5 shrink-0" />
                  <span>
                    This sends 100,000 HASH to <Mono text={terms()?.destination ?? ""} head={12} tail={8} copy /> with the memo{" "}
                    <span class="mono">{terms()?.memo}</span>. A chain payment cannot be reversed, by us or by anyone.
                  </span>
                </p>
                <label class="text-xs text-muted" for="verify-confirm">
                  Type VERIFY to confirm
                </label>
                <div class="flex items-center gap-2">
                  <Input id="verify-confirm" class="w-40" value={confirm()} onInput={(e) => setConfirm(e.currentTarget.value)} spellcheck={false} />
                  <Button size="sm" loading={busy()} disabled={confirm().trim() !== "VERIFY"} onClick={() => void buy()}>
                    Pay 100,000 HASH
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setConfirm(""); }}>
                    Cancel
                  </Button>
                </div>
                <details class="text-xs text-muted">
                  <summary class="cursor-pointer">Already paid but no badge?</summary>
                  <p class="mt-1">
                    The payment and the profile claim are two steps, so a payment is never lost to an app error. Paste the transaction hash and it
                    will be recorded — you do not pay twice.
                  </p>
                  <div class="mt-1 flex items-center gap-2">
                    <Input class="flex-1" value={recover()} onInput={(e) => setRecover(e.currentTarget.value)} placeholder="Transaction hash" spellcheck={false} />
                    <Button size="sm" variant="secondary" loading={busy()} disabled={recover().trim().length !== 64} onClick={() => void record()}>
                      Record
                    </Button>
                  </div>
                </details>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
