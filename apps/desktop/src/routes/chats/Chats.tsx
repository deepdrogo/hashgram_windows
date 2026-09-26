// Chats: private conversations over MLS.
//
// A message goes into the sealed local history before it goes anywhere, so
// it appears the moment it is typed and survives being offline. The state
// beside it is the truth: queued means this device still has it, sent means
// a store node took it. Nothing here claims the other person read it.
import { For, Show, createEffect, createResource, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { useNavigate, useParams } from "@solidjs/router";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Send, Search, RefreshCw, Clock, UserPlus, Users, LogOut, MessageSquare, Paperclip, Play, X, File as FileIcon, Volume2, VolumeX } from "lucide-solid";
import { Button, Dialog, Empty, Field, Input, Notice, Skeleton } from "~/components/ui";
import { OfflineBanner } from "~/components/States";
import { PersonAvatar, Who } from "~/components/identity";
import { EmojiPicker } from "~/components/social/EmojiPicker";
import { ipc, on, errText, type ConversationView, type ChatMessage, type ChatAttachment, type ChatPage, type ContactRecord } from "~/lib/ipc";
import { store } from "~/lib/store";
import { cachedResource } from "~/lib/cache";
import { prefetchAttachment } from "~/lib/prefetch";
import { shortWhen, formatBytes } from "~/lib/format";
import { confirm, pickFile } from "~/lib/dialogs";
import { measureVideo } from "~/lib/mediameta";
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

  const [conversations, { refetch }] = cachedResource(
    () => ({ t: tick(), locked: store.locked(), sync: store.ticks().people }),
    (k) => (k.locked ? null : "chats:list"),
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

  const [page, { mutate }] = cachedResource(
    () => ({ id: props.id, t: tick() }),
    (k) => `chat:history:${k.id}`,
    (k) => ipc.chatHistory(k.id, 0, 200).catch(() => ({ messages: [], attachments: [] }) as ChatPage),
  );
  const messages = () => page()?.messages;
  const filesOf = (id: string) => (page()?.attachments ?? []).filter((a) => a.message_id === id);

  // Fetch and decrypt the pictures in view in the background, so scrolling
  // a conversation does not wait on one blob at a time.
  createEffect(() => {
    for (const a of (page()?.attachments ?? []).slice(-12)) {
      if (a.kind === "image") prefetchAttachment(a.message_id, a.index);
    }
  });

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
      mutate((prev) => ({ messages: [...(prev?.messages ?? []), row], attachments: prev?.attachments ?? [] }));
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
        <Show when={page.loading && !page()}>
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
                <Show when={filesOf(m.id).length}>
                  <ChatAttachments files={filesOf(m.id)} />
                </Show>
                <Show when={m.text}>
                  <p class="whitespace-pre-wrap selectable">{m.text}</p>
                </Show>
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
        <Button
          variant="ghost"
          size="icon-sm"
          title="Send a picture, a video or a file"
          aria-label="Attach"
          loading={sending()}
          onClick={async () => {
            const picked = await pickFile({
              multiple: true,
              filters: [{ name: "Pictures and video", extensions: ["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "mov"] }],
            });
            if (!picked.length) return;
            setSending(true);
            try {
              const files = [];
              for (const path of picked.slice(0, 10)) files.push({ path, client: await measureVideo(path) });
              await ipc.chatSendMedia(props.id, text().trim(), files);
              setText("");
              rememberDraft(`chat:${props.id}`, "");
              setTick((n) => n + 1);
              props.onSent();
            } catch (e) {
              store.toast(errText(e), "error");
            } finally {
              setSending(false);
            }
          }}
        >
          <Paperclip size={16} />
        </Button>
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

/**
 * The files in one message.
 *
 * Each is fetched and decrypted by the Rust side on demand — the webview
 * only ever holds a path to a decrypted copy in the scratch folder, which
 * is wiped when the vault locks.
 */
function ChatAttachments(props: { files: ChatAttachment[] }) {
  const [open, setOpen] = createSignal<ChatAttachment | null>(null);
  return (
    <>
      <div class={`mb-1 grid gap-1 ${props.files.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        <For each={props.files}>{(f) => <AttachmentTile file={f} onOpen={() => setOpen(f)} />}</For>
      </div>
      <Show when={open()}>
        {(f) => <AttachmentViewer file={f()} onClose={() => setOpen(null)} />}
      </Show>
    </>
  );
}

/** Decrypts one attachment and hands back a path, once. */
function useAttachment(file: () => ChatAttachment) {
  return createResource(
    () => ({ id: file().message_id, i: file().index }),
    async (k) => {
      try {
        return convertFileSrc(await ipc.chatAttachmentOpen(k.id, k.i));
      } catch {
        return null;
      }
    },
  );
}

function AttachmentTile(props: { file: ChatAttachment; onOpen: () => void }) {
  const [src] = useAttachment(() => props.file);
  const visual = () => props.file.kind === "image" || props.file.kind === "video";
  return (
    <Show
      when={visual()}
      fallback={
        <button type="button" class="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left text-xs" onClick={props.onOpen}>
          <FileIcon size={14} class="shrink-0 text-muted" />
          <span class="min-w-0 flex-1 truncate">{props.file.name}</span>
          <span class="shrink-0 text-muted">{formatBytes(props.file.size)}</span>
        </button>
      }
    >
      <button type="button" class="relative overflow-hidden rounded-md border border-border bg-surface-2" onClick={props.onOpen} title={props.file.name}>
        <Show when={src()} fallback={<span class="block h-28 w-full" />}>
          {/* A video's first frame comes from a <video> element. An <img>
              pointed at video bytes decodes nothing, and the tile used to
              collapse to an empty strip with a play button on it. Chat
              attachments carry no poster — they are sealed, and a poster
              would be a second sealed blob per video — so the element that
              can decode the file is the one that draws the frame. */}
          <Show
            when={props.file.kind === "video"}
            fallback={<img src={src() ?? ""} alt="" loading="lazy" class="max-h-56 w-full object-cover" />}
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video src={src() ?? ""} class="max-h-56 w-full object-cover" preload="metadata" muted playsinline controls={false} />
          </Show>
        </Show>
        <Show when={props.file.kind === "video"}>
          <span class="absolute inset-0 flex items-center justify-center">
            <span class="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-bg/70">
              <Play size={16} />
            </span>
          </span>
          <Show when={props.file.duration_ms > 0}>
            <span class="absolute bottom-1.5 right-1.5 rounded bg-bg/80 px-1.5 py-0.5 text-[10.5px] tnum">
              {`${Math.floor(props.file.duration_ms / 60000)}:${String(Math.round(props.file.duration_ms / 1000) % 60).padStart(2, "0")}`}
            </span>
          </Show>
        </Show>
      </button>
    </Show>
  );
}

function AttachmentViewer(props: { file: ChatAttachment; onClose: () => void }) {
  const [src] = useAttachment(() => props.file);
  const [muted, setMuted] = createSignal(true);
  onMount(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", esc);
    onCleanup(() => window.removeEventListener("keydown", esc));
  });
  return (
    <Portal>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-bg/95" role="dialog" aria-label={props.file.name} onClick={props.onClose}>
        <button type="button" class="absolute right-3 top-3 btn-ghost btn-icon-sm" aria-label="Close" onClick={props.onClose}>
          <X size={16} />
        </button>
        <div class="relative max-h-[88vh] max-w-[88vw]" onClick={(e) => e.stopPropagation()}>
          <Show when={src()} fallback={<p class="text-sm text-muted">Fetching and decrypting…</p>}>
            <Show
              when={props.file.kind === "video"}
              fallback={
                <Show when={props.file.kind === "image"} fallback={<SaveFile file={props.file} src={src() ?? ""} />}>
                  <img src={src() ?? ""} alt="" class="max-h-[88vh] max-w-[88vw] object-contain" />
                </Show>
              }
            >
              {/* Plays by itself, silent. Sound is the viewer's decision —
                  a chat that starts talking out loud the moment a thumbnail
                  is tapped is one people stop tapping. */}
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={src() ?? ""}
                class="max-h-[88vh] max-w-[88vw] bg-surface-2"
                controls
                autoplay
                muted={muted()}
                playsinline
              />
              <button
                type="button"
                class="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border border-border bg-bg/80 px-2 py-1 text-[11px]"
                onClick={() => setMuted((m) => !m)}
              >
                <Show when={muted()} fallback={<><Volume2 size={12} /> Sound on</>}>
                  <VolumeX size={12} /> Sound off — click for sound
                </Show>
              </button>
            </Show>
          </Show>
        </div>
      </div>
    </Portal>
  );
}

function SaveFile(props: { file: ChatAttachment; src: string }) {
  return (
    <div class="card p-6 text-center">
      <FileIcon size={28} class="mx-auto text-muted" />
      <p class="mt-2 text-[13px] font-medium">{props.file.name}</p>
      <p class="text-xs text-muted">{formatBytes(props.file.size)}</p>
      <p class="mt-3 text-xs text-muted">Decrypted on this PC. Open the folder from Drive to keep a copy.</p>
    </div>
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
