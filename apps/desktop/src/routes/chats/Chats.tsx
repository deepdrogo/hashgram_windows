// Chats: private conversations over MLS.
//
// A message goes into the sealed local history before it goes anywhere, so
// it appears the moment it is typed and survives being offline. The state
// beside it is the truth: queued means this device still has it, sent means
// a store node took it. Nothing here claims the other person read it.
import { For, Show, createEffect, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Send, Search, RefreshCw, Clock, UserPlus, Users, LogOut, MessageSquare } from "lucide-solid";
import { Button, Dialog, Empty, Field, Input, Notice, Skeleton } from "~/components/ui";
import { OfflineBanner } from "~/components/States";
import { PersonAvatar, Who } from "~/components/identity";
import { EmojiPicker } from "~/components/social/EmojiPicker";
import { ipc, on, errText, type ConversationView, type ChatMessage, type ContactRecord } from "~/lib/ipc";
import { store } from "~/lib/store";
import { shortWhen } from "~/lib/format";
import { confirm } from "~/lib/dialogs";
import { rememberDraft, recallDraft } from "~/lib/uistate";

export function ChatsRoute() {
  const params = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [filter, setFilter] = createSignal("");
  const [tick, setTick] = createSignal(0);
  const [newGroup, setNewGroup] = createSignal(false);

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
          <Button variant="ghost" size="icon-sm" title="New group" onClick={() => setNewGroup(true)}>
            <Users size={14} />
          </Button>
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
            <Empty title="No conversations yet">
              A chat appears here once you open one or somebody writes to you. Open a profile and press Chat, or start
              a group.
            </Empty>
          </Show>
          <For each={shown()}>
            {(c) => (
              <button
                type="button"
                class={`row flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left ${params.id === c.id ? "bg-surface-2" : ""}`}
                onClick={() => navigate(`/chats/${c.id}`)}
              >
                <Show when={c.direct} fallback={<span class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted"><Users size={15} /></span>}>
                  <PersonAvatar address={c.peer} size={30} />
                </Show>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-2">
                    <Show when={c.direct} fallback={<span class="min-w-0 flex-1 truncate text-[13px] font-medium">{c.name || `Group of ${c.members.length}`}</span>}>
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
          {(id) => <ChatThread id={id()} conversation={(conversations() ?? []).find((c) => c.id === id())} onSent={() => void refetch()} onLeft={() => { void refetch(); navigate("/chats"); }} />}
        </Show>
      </div>
      <NewGroupDialog open={newGroup()} onClose={() => setNewGroup(false)} onCreated={async (id) => { await refetch(); navigate(`/chats/${id}`); }} />
    </div>
  );
}

/** Starting a group: a name and the people it begins with. */
function NewGroupDialog(props: { open: boolean; onClose: () => void; onCreated: (id: string) => void | Promise<void> }) {
  const [name, setName] = createSignal("");
  const [picked, setPicked] = createSignal<ContactRecord[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [contacts] = createResource(
    () => (props.open ? store.ticks().people : null),
    () => ipc.peopleList("all").catch(() => [] as ContactRecord[]),
  );
  const toggle = (c: ContactRecord) =>
    setPicked((p) => (p.some((x) => x.address === c.address) ? p.filter((x) => x.address !== c.address) : [...p, c]));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await ipc.chatCreateGroup(name(), picked().map((c) => c.address));
      store.toast("Group created");
      setName("");
      setPicked([]);
      await props.onCreated(id);
      props.onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} title="New group">
      <div class="flex flex-col gap-3">
        <Field label="Group name">
          <Input value={name()} maxLength={64} placeholder="Saturday climbers" onInput={(e) => setName(e.currentTarget.value)} />
        </Field>
        <div>
          <p class="mb-1 text-xs text-muted">
            Who is in it. Everyone's devices join the group, so they can read it on their phone too.
          </p>
          <div class="max-h-56 overflow-auto rounded-md border border-border">
            <Show when={(contacts() ?? []).length} fallback={<p class="p-3 text-xs text-muted">No contacts yet. Add people from their profile first.</p>}>
              <For each={contacts() ?? []}>
                {(c) => (
                  <label class="row flex cursor-default items-center gap-2 border-b border-border px-2 py-1.5 text-[13px] last:border-0">
                    <input
                      type="checkbox"
                      checked={picked().some((x) => x.address === c.address)}
                      onChange={() => toggle(c)}
                    />
                    <PersonAvatar address={c.address} size={22} />
                    <Who address={c.address} class="min-w-0 flex-1" size="sm" />
                  </label>
                )}
              </For>
            </Show>
          </div>
        </div>
        <Show when={error()}>
          <Notice strong>{error()}</Notice>
        </Show>
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-muted">{picked().length} selected</span>
          <Button loading={busy()} disabled={name().trim().length < 2 || !picked().length} onClick={() => void create()}>
            Create group
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * One conversation. Exported because a Space's chat is the same thing over
 * the Space's own MLS group — there is no second messenger, and no second
 * copy of this code.
 */
export function ChatThread(props: { id: string; conversation?: ConversationView; onSent: () => void; onLeft: () => void }) {
  const navigate = useNavigate();
  const [text, setText] = createSignal(recallDraft(`chat:${props.id}`));
  const [sending, setSending] = createSignal(false);
  const [tick, setTick] = createSignal(0);
  const [members, setMembers] = createSignal(false);
  let scroller: HTMLDivElement | undefined;
  let input!: HTMLInputElement;

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

  const group = () => props.conversation && !props.conversation.direct;

  return (
    <>
      <Show when={props.conversation}>
        {(c) => (
          <div class="flex items-center gap-2 border-b border-border px-4 py-2">
            <Show when={c().direct} fallback={<span class="flex h-7 w-7 items-center justify-center rounded-md bg-surface-2 text-muted"><Users size={14} /></span>}>
              <PersonAvatar address={c().peer} size={28} />
            </Show>
            <span class="min-w-0 flex-1">
              <Show when={c().direct} fallback={<span class="block truncate text-[13px] font-medium">{c().name || `Group of ${c().members.length}`}</span>}>
                <Who address={c().peer} class="text-[13px]" />
              </Show>
              <Show when={!c().direct}>
                <button type="button" class="text-[11px] text-muted hover:text-fg" onClick={() => setMembers(true)}>
                  {c().members.length} people
                </button>
              </Show>
            </span>
            <Show when={c().direct}>
              <Button size="sm" variant="ghost" onClick={() => navigate(`/profile/${c().peer}`)}>
                Profile
              </Button>
            </Show>
            <Button
              size="sm"
              variant="ghost"
              title={c().direct ? "Remove this conversation from the list" : "Leave this group"}
              onClick={async () => {
                if (!(await confirm(c().direct ? "Remove this conversation from your list?" : "Leave this group? You stop receiving its messages."))) return;
                try {
                  await ipc.chatLeave(c().id);
                  props.onLeft();
                } catch (e) {
                  store.toast(errText(e), "error");
                }
              }}
            >
              <LogOut size={13} />
            </Button>
          </div>
        )}
      </Show>

      <div ref={scroller} class="min-h-0 flex-1 overflow-auto px-4 py-3">
        <Show when={messages.loading && !messages()}>
          <Skeleton lines={5} />
        </Show>
        <Show when={messages() && !messages()!.length}>
          <Empty title="Say something">This conversation is end-to-end encrypted. Only the devices in it can read what you write.</Empty>
        </Show>
        <For each={messages() ?? []}>
          {(m) => (
            <div class={`mb-2 flex items-end gap-2 ${m.outgoing ? "justify-end" : "justify-start"}`}>
              <Show when={!m.outgoing && group()}>
                <PersonAvatar address={m.sender} size={22} />
              </Show>
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
          ref={input}
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
        <EmojiPicker
          onPick={(emoji) => {
            // Insert at the caret, not at the end: people add an emoji in
            // the middle of a sentence as often as at its end.
            const at = input?.selectionStart ?? text().length;
            setText(`${text().slice(0, at)}${emoji}${text().slice(at)}`);
            requestAnimationFrame(() => {
              input?.focus();
              input?.setSelectionRange(at + emoji.length, at + emoji.length);
            });
          }}
        />
        <Button loading={sending()} disabled={!text().trim()} onClick={() => void send()}>
          <Send size={13} /> Send
        </Button>
      </div>
      <p class="border-t border-border px-4 py-1.5 text-[11px] text-muted">
        End-to-end encrypted. Deleting a message removes it from this device — a copy the other person's device
        already decrypted is theirs, and undelivered ciphertext sits on store nodes until it expires.
      </p>

      <Show when={group() ? props.conversation : undefined}>
        {(c) => <MembersDialog open={members()} onClose={() => setMembers(false)} conversation={c()} onChanged={props.onSent} />}
      </Show>
    </>
  );
}

/** Who is in a group, and adding somebody to it. */
function MembersDialog(props: { open: boolean; onClose: () => void; conversation: ConversationView; onChanged: () => void }) {
  const navigate = useNavigate();
  const [adding, setAdding] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const add = async () => {
    setBusy(true);
    try {
      await ipc.chatAddMember(props.conversation.id, adding().trim());
      store.toast("Added");
      setAdding("");
      props.onChanged();
    } catch (e) {
      store.toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={props.open} onClose={props.onClose} title={props.conversation.name || "Group"}>
      <div class="flex flex-col gap-3">
        <div class="max-h-64 overflow-auto rounded-md border border-border">
          <For each={props.conversation.members}>
            {(a) => (
              <div class="row flex items-center gap-2 border-b border-border px-2 py-1.5 text-[13px] last:border-0">
                <PersonAvatar address={a} size={22} />
                <Who address={a} class="min-w-0 flex-1" size="sm" />
                <Button size="sm" variant="ghost" onClick={() => { props.onClose(); navigate(`/profile/${a}`); }}>
                  Profile
                </Button>
              </div>
            )}
          </For>
        </div>
        <Field label="Add somebody" hint="Their hash1 address. They see messages from the moment they join, not the history before it.">
          <Input mono value={adding()} placeholder="hash1…" onInput={(e) => setAdding(e.currentTarget.value)} />
        </Field>
        <div class="flex justify-end">
          <Button size="sm" loading={busy()} disabled={!adding().trim().startsWith("hash1")} onClick={() => void add()}>
            Add
          </Button>
        </div>
      </div>
    </Dialog>
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
