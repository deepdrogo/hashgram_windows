// Chats: private conversations over MLS.
//
// A message goes into the sealed local history before it goes anywhere, so
// it appears the moment it is typed and survives being offline. The state
// beside it is the truth: queued means this device still has it, sent means
// a store node took it. Nothing here claims the other person read it.
import { For, Show, createEffect, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Send, Search, RefreshCw, Clock, UserPlus, MessageSquare } from "lucide-solid";
import { Button, Empty, Input, Notice, Skeleton } from "~/components/ui";
import { OfflineBanner } from "~/components/States";
import { PersonAvatar, Who } from "~/components/identity";
import { ipc, on, errText, type ConversationView, type ChatMessage } from "~/lib/ipc";
import { store } from "~/lib/store";
import { shortWhen } from "~/lib/format";
import { rememberDraft, recallDraft } from "~/lib/uistate";

export function ChatsRoute() {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [filter, setFilter] = createSignal("");
  const [tick, setTick] = createSignal(0);

  onMount(() => {
    const p = on("chat:changed", () => setTick((n) => n + 1));
    onCleanup(() => void p.then((un) => un()));
  });

  const [conversations, { refetch }] = createResource(
    () => ({ t: tick(), locked: store.locked(), sync: store.ticks().people }),
    (k) => (k.locked ? Promise.resolve([] as ConversationView[]) : ipc.chatList().catch(() => [] as ConversationView[])),
  );

  const shown = () => {
    const q = filter().trim().toLowerCase();
    const list = conversations() ?? [];
    return q ? list.filter((c) => c.name.toLowerCase().includes(q) || c.peer.toLowerCase().includes(q) || c.last_text.toLowerCase().includes(q)) : list;
  };

  const startWith = async (address: string) => {
    try {
      const id = await ipc.chatOpen(address);
      await refetch();
      navigate(`/chats/${id}`);
    } catch (e) {
      store.toast(errText(e), "error");
    }
  };

  return (
    <div class="flex h-full min-h-0">
      <div class="flex w-[300px] shrink-0 flex-col border-r border-border">
        <div class="flex items-center gap-2 border-b border-border px-3 py-2">
          <div class="relative flex-1">
            <Search size={13} class="pointer-events-none absolute left-2 top-2 text-muted" />
            <Input class="h-7 pl-7" placeholder="Search your chats…" value={filter()} onInput={(e) => setFilter(e.currentTarget.value)} />
          </div>
          <Button variant="ghost" size="icon-sm" title="Start a chat from a profile or a contact" onClick={() => navigate("/contacts")}>
            <UserPlus size={14} />
          </Button>
        </div>
        <div class="min-h-0 flex-1 overflow-auto">
          <Show when={conversations.loading && !conversations()}>
            <div class="p-3">
              <Skeleton lines={4} />
            </div>
          </Show>
          <Show when={conversations() && !shown().length}>
            <Empty title="No conversations yet">Open somebody's profile and press Chat, or pick a contact.</Empty>
          </Show>
          <For each={shown()}>
            {(c) => (
              <button
                type="button"
                class={`row flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left ${params.id === c.id ? "bg-surface-2" : ""}`}
                onClick={() => navigate(`/chats/${c.id}`)}
              >
                <PersonAvatar address={c.peer || c.members[0]!} size={30} />
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-2">
                    <Show when={c.direct} fallback={<span class="truncate text-[13px] font-medium">{c.name || "Group"}</span>}>
                      <Who address={c.peer} class="min-w-0 flex-1 text-[13px]" />
                    </Show>
                    <Show when={c.last_at_ms > 0}>
                      <span class="shrink-0 text-[11px] text-muted">{shortWhen(c.last_at_ms)}</span>
                    </Show>
                  </span>
                  <span class="mt-0.5 block truncate text-xs text-muted">{c.last_text || "No messages yet"}</span>
                </span>
                <Show when={c.unread > 0}>
                  <span class="badge-strong tnum">{c.unread > 99 ? "99+" : c.unread}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <Show when={params.id} fallback={<Empty title="Pick a conversation" icon={<MessageSquare size={18} />}>Messages are end-to-end encrypted and held for you by store nodes while you are offline.</Empty>}>
          {(id) => <Thread id={id()} onSent={() => void refetch()} onStart={startWith} />}
        </Show>
      </div>
    </div>
  );
}

function Thread(props: { id: string; onSent: () => void; onStart: (address: string) => void }) {
  const [text, setText] = createSignal(recallDraft(`chat:${props.id}`));
  const [sending, setSending] = createSignal(false);
  const [tick, setTick] = createSignal(0);
  let scroller: HTMLDivElement | undefined;

  onMount(() => {
    const p = on("chat:changed", () => setTick((n) => n + 1));
    onCleanup(() => void p.then((un) => un()));
  });

  const [messages, { mutate }] = createResource(
    () => ({ id: props.id, t: tick() }),
    (k) => ipc.chatHistory(k.id, 0, 200).catch(() => [] as ChatMessage[]),
  );

  // Coming back to a conversation should land at the newest message.
  createEffect(() => {
    if (messages()?.length && scroller) {
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
    }
  });

  createEffect(() => {
    const last = messages()?.at(-1);
    if (last) void ipc.chatMarkRead(props.id, last.at_ms).catch(() => undefined);
  });

  createEffect(() => rememberDraft(`chat:${props.id}`, text()));

  const send = async () => {
    const body = text().trim();
    if (!body) return;
    setSending(true);
    try {
      const row = await ipc.chatSend(props.id, body);
      mutate((prev) => [...(prev ?? []), row]);
      setText("");
      rememberDraft(`chat:${props.id}`, "");
      props.onSent();
    } catch (e) {
      store.toast(errText(e), "error");
    } finally {
      setSending(false);
    }
  };

  const queued = () => (messages() ?? []).filter((m) => m.state === "queued").length;

  return (
    <>
      <div ref={scroller} class="min-h-0 flex-1 overflow-auto px-4 py-3">
        <Show when={messages.loading && !messages()}>
          <Skeleton lines={5} />
        </Show>
        <Show when={messages() && !messages()!.length}>
          <Empty title="Say something">This conversation is end-to-end encrypted. Only the devices in it can read what you write.</Empty>
        </Show>
        <For each={messages() ?? []}>
          {(m) => (
            <div class={`mb-2 flex ${m.outgoing ? "justify-end" : "justify-start"}`}>
              <div class={`max-w-[70%] rounded-lg px-3 py-2 text-[13px] ${m.outgoing ? "bg-surface-2" : "card"}`}>
                <Show when={!m.outgoing}>
                  <Who address={m.sender} size="sm" class="mb-0.5 text-muted" />
                </Show>
                <p class="whitespace-pre-wrap selectable">{m.text}</p>
                <p class="mt-1 flex items-center gap-1 text-[11px] text-muted">
                  <span>{shortWhen(m.at_ms)}</span>
                  <Show when={m.outgoing && m.state === "queued"}>
                    <Clock size={10} /> <span title="Still on this device; it will go out when a node answers">waiting</span>
                  </Show>
                  <Show when={m.outgoing && m.state === "failed"}>
                    <span class="text-fg">not sent</span>
                  </Show>
                </p>
              </div>
            </div>
          )}
        </For>
      </div>
      <Show when={queued() > 0}>
        <div class="flex items-center gap-2 border-t border-border px-4 py-1.5 text-xs text-muted">
          <Clock size={12} />
          <span class="flex-1">
            {queued()} message{queued() === 1 ? "" : "s"} waiting on this device.
          </span>
          <Button size="sm" variant="ghost" onClick={() => void ipc.chatFlush().then(() => setTick((n) => n + 1))}>
            <RefreshCw size={12} /> Try now
          </Button>
        </div>
      </Show>
      <div class="flex items-end gap-2 border-t border-border px-4 py-2">
        <Input
          class="flex-1"
          placeholder="Write a message…"
          value={text()}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button loading={sending()} disabled={!text().trim()} onClick={() => void send()}>
          <Send size={13} /> Send
        </Button>
      </div>
    </>
  );
}

/** Shown when the recipient does not accept chats. */
export function ChatRefused(props: { onMail: () => void }) {
  return (
    <Notice title="This user is not accepting Chats">
      You can contact them using HashMail.
      <Button class="mt-2" size="sm" onClick={props.onMail}>
        Write mail
      </Button>
    </Notice>
  );
}
