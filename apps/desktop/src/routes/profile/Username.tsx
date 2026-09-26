// Choosing a username.
//
// A username is who you are on the network — it is what people type, what
// your mail address is made of, and what appears beside your name
// everywhere. It is registered on chain, and the wallet is what signs the
// transaction, but that is plumbing: the decision belongs on the profile,
// so this is where the user makes it.
import { Show, createResource, createSignal } from "solid-js";
import { AtSign, Check, X } from "lucide-solid";
import { Button, Field, Input, Notice } from "~/components/ui";
import { Mono } from "~/components/identity";
import { ipc, errText } from "~/lib/ipc";
import { store } from "~/lib/store";
import { formatHash } from "~/lib/format";

export function UsernameCard(props: { current: string; address: string; onRegistered: () => void }) {
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const cleaned = () => name().trim().toLowerCase().replace(/^@/, "");
  const [availability] = createResource(
    () => (cleaned().length >= 2 ? cleaned() : null),
    (n) => ipc.walletUsernameAvailability(n).catch(() => null),
  );

  const register = async () => {
    setBusy(true);
    setError(null);
    try {
      await ipc.walletRegisterUsername(cleaned());
      store.toast("Username submitted — it is yours once the transaction commits.");
      setName("");
      props.onRegistered();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="card p-4">
      <h2 class="flex items-center gap-2 text-[13px] font-semibold">
        <AtSign size={14} /> Username
      </h2>
      <Show
        when={!props.current}
        fallback={
          <p class="mt-2 text-[13px]">
            You are <span class="font-medium">@{props.current}</span>, and your mail address is{" "}
            <span class="mono">{props.current}@hashgram.io</span>. It is registered on chain to{" "}
            <Mono text={props.address} head={10} tail={6} />.
          </p>
        }
      >
        <p class="mt-1 text-xs text-muted">
          Without one, people have to type your full address. A username is registered on chain, costs 1 HASH and is
          yours until it expires.
        </p>
        <Field class="mt-3" label="Pick a name" hint="Letters, digits, dot, dash and underscore." error={error() ?? undefined}>
          <Input mono value={name()} maxLength={32} placeholder="yourname" onInput={(e) => setName(e.currentTarget.value)} />
        </Field>
        <Show when={cleaned().length >= 2 && availability()}>
          {(a) => (
            <p class="mt-1 flex items-center gap-1 text-xs">
              <Show when={a().available} fallback={<><X size={12} /> <span class="text-muted">{a().reason || "taken"}</span></>}>
                <Check size={12} class="text-brand" />
                <span class="text-muted">
                  @{a().normalized} is free. Registration costs {formatHash("1000000", 0, 0)} HASH.
                </span>
              </Show>
            </p>
          )}
        </Show>
        <Show when={store.identity()?.this_device_registered === false}>
          <Notice class="mt-3">This PC is not registered for your identity yet, so it cannot sign the transaction. Finish that in Wallet → Devices first.</Notice>
        </Show>
        <Button
          class="mt-3"
          size="sm"
          loading={busy()}
          disabled={!availability()?.available || store.identity()?.this_device_registered === false}
          onClick={() => void register()}
        >
          Register @{cleaned() || "…"}
        </Button>
      </Show>
    </div>
  );
}
