// A person, by public key. Loaded from chain: address, verified @username,
// identity and devices. Display name (a signed social event) arrives in
// Stage 2 and will always sit next to the verified handle.
import { Show, For } from "solid-js";
import { useParams } from "@solidjs/router";
import { Card, Notice, Skeleton, Badge, Button } from "~/components/ui";
import { PersonLabel, Mono, Avatar, VerifiedBy } from "~/components/identity";
import { useChain, readOf } from "~/lib/chain";
import { pick, str, arr } from "~/lib/ipc";
import { isHashAddress } from "~/lib/format";
import { useNavigate } from "@solidjs/router";

export function Profile() {
  const params = useParams<{ address: string }>();
  const navigate = useNavigate();
  const address = () => params.address;
  const valid = () => isHashAddress(address());
  const [reverse] = useChain(() => (valid() ? `hashgram/username/v1/reverse/${address()}` : null));
  const [identity] = useChain(() => (valid() ? `hashgram/identity/v1/identity/${address()}` : null));
  const [devices] = useChain(() => (valid() ? `hashgram/identity/v1/devices/${address()}` : null));
  const [balance] = useChain(() => (valid() ? `cosmos/bank/v1beta1/balances/${address()}/by_denom?denom=uhash` : null));
  const username = () => (reverse()?.ok ? str(pick((reverse() as { value: unknown }).value, "name")) || null : null);
  const found = () => identity()?.ok && pick((identity() as { value: unknown }).value, "found") === true;
  const deviceList = () => (devices()?.ok ? arr(pick((devices() as { value: unknown }).value, "devices")) : []);

  return (
    <div class="page flex flex-col gap-4">
      <Show when={valid()} fallback={<Notice strong>Not a Hashgram address.</Notice>}>
        <div class="flex items-center gap-4">
          <Avatar address={address()} size={56} />
          <div class="min-w-0">
            <PersonLabel person={{ address: address(), username: username() }} size="lg" copy />
            <div class="mt-1">
              <Mono text={address()} full copy class="text-xs text-muted" />
            </div>
          </div>
          <span class="flex-1" />
          <Button variant="secondary" onClick={() => navigate(`/wallet/send?to=${address()}`)}>
            Send HASH
          </Button>
          <Button variant="secondary" disabled title="Messaging arrives in Stage 2">
            Message
          </Button>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <Card title="Identity">
            <div class="p-4 text-sm">
              <Show when={!identity.loading} fallback={<Skeleton lines={2} />}>
                <Show when={found()} fallback={<p class="text-muted">No identity registered on chain for this address. Messages cannot be verified for it yet.</p>}>
                  <p>Registered · root rotations {str(pick((identity() as { value: unknown }).value, "identity.rotation_count"), "0")}</p>
                </Show>
              </Show>
            </div>
          </Card>
          <Card title="Devices">
            <Show when={deviceList().length} fallback={<p class="p-4 text-sm text-muted">None.</p>}>
              <ul class="p-2">
                <For each={deviceList()}>
                  {(d) => (
                    <li class="flex items-center justify-between px-2 py-1 text-sm">
                      <span>{str(pick(d, "label"), "(no label)")}</span>
                      <span class="flex items-center gap-2">
                        <Badge>{str(pick(d, "platform"))}</Badge>
                        <Show when={pick(d, "revoked") === true}>
                          <Badge strong>revoked</Badge>
                        </Show>
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Card>
          <Card title="Balance">
            <div class="p-4">
              <Show when={balance()?.ok} fallback={<Skeleton />}>
                <p class="mono text-lg">{str(pick((balance() as { value: unknown }).value, "balance.amount"), "0")} uhash</p>
                <VerifiedBy verification={readOf(balance())?.verification} source={readOf(balance())?.source} />
              </Show>
            </div>
          </Card>
        </div>
        <Notice>Display names, posts and reels for this person arrive in Stage 2. Whatever a display name says, the verified handle above is who this is.</Notice>
      </Show>
    </div>
  );
}
