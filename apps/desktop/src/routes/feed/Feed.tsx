// Feed: Friends / Following / Circles / Explore (indexer-gated), all
// chronological. Composer for public posts (text, media, hashtags,
// sensitive) and Circle posts (circle picker, poll builder). Post view
// with comments and reactions.
import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Image as ImageIcon, Send, MessageSquare, Heart, Repeat2, Trash2, Plus, Users, RefreshCw, Vote, Eye, EyeOff, UserPlus, X } from "lucide-solid";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Button, Checkbox, Dialog, Field, Input, Notice, Tabs, Textarea, Badge, Empty, Select } from "~/components/ui";
import { OfflineBanner, ErrorState } from "~/components/States";
import { Who, Avatar } from "~/components/identity";
import { ipc, errText, type FeedItem, type CircleInfo, type CircleItemView, type MergedItem, type PollInput } from "~/lib/ipc";
import { store } from "~/lib/store";
import { t } from "~/lib/i18n";
import { formatMs, shortWhen, splitRecipients } from "~/lib/format";
import { pickFile, confirm } from "~/lib/dialogs";

type Tab = "friends" | "following" | "circles" | "explore";

function postText(it: FeedItem): string {
  const p = it.payload as { text?: string; comment?: string };
  return String(p.text ?? p.comment ?? "");
}
function hashtags(it: FeedItem): string[] {
  const p = it.payload as { hashtags?: string[] };
  return Array.isArray(p.hashtags) ? p.hashtags : [];
}

function Media(props: { cid: string; mime: string; sensitive?: boolean }) {
  const [shown, setShown] = createSignal(!props.sensitive);
  const [src] = createResource(
    () => (shown() && props.mime.startsWith("image/") ? props.cid : null),
    (cid) => ipc.feedMediaFetch(cid, props.mime).then(convertFileSrc).catch(() => null),
  );
  return (
    <Show when={props.mime.startsWith("image/")} fallback={<Badge>{props.mime}</Badge>}>
      <Show when={shown()} fallback={<Button variant="secondary" size="sm" onClick={() => setShown(true)}><EyeOff size={12} /> sensitive — show</Button>}>
        <Show when={src()} fallback={<div class="skeleton h-40 w-full" />}>
          <img src={src()!} alt="" class="max-h-96 rounded-md border border-border object-contain" />
        </Show>
      </Show>
    </Show>
  );
}

export function FeedRoute() {
  const params = useParams<{ tab?: string; id?: string }>();
  const navigate = useNavigate();
  const tab = (): Tab => (params.tab as Tab) || "friends";
  const indexer = () => !!store.settings()?.network.indexer_url.trim();
  const [compose, setCompose] = createSignal(false);
  const [tag, setTag] = createSignal("");

  const [items, { refetch }] = createResource(
    () => ({ tab: tab(), tick: store.ticks().feed, tag: tag().trim() }),
    async (k) => {
      if (k.tab === "friends") return { kind: "public" as const, items: await ipc.feedFriends(0, 100) };
      if (k.tab === "following") return { kind: "public" as const, items: await ipc.feedFollowing(0, 100) };
      if (k.tab === "explore") {
        const raw = await ipc.feedExplore(0, 50, k.tag || undefined);
        const arr = raw && typeof raw === "object" ? ((raw as { items?: unknown[]; events?: unknown[] }).items ?? (raw as { events?: unknown[] }).events ?? []) : [];
        return { kind: "explore" as const, items: arr as Record<string, unknown>[] };
      }
      return { kind: "circles" as const, items: await ipc.circlesMerged(0, 100) };
    },
  );

  return (
    <div class="flex h-full flex-col">
      <OfflineBanner />
      <Show when={params.id} fallback={
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex items-center gap-2 border-b border-border px-3">
            <Tabs
              class="flex-1 border-b-0"
              value={tab()}
              onChange={(v) => navigate(`/feed/${v}`)}
              tabs={[
                { id: "friends", label: t("feed_friends") },
                { id: "following", label: t("feed_following") },
                { id: "circles", label: t("feed_circles") },
                { id: "explore", label: t("feed_explore"), disabled: !indexer(), title: indexer() ? "" : t("feed_explore_off") },
              ]}
            />
            <Show when={tab() === "explore"}>
              <Input class="h-7 w-40" placeholder="#hashtag" value={tag()} onInput={(e) => setTag(e.currentTarget.value)} />
            </Show>
            <Button variant="ghost" size="icon-sm" title="Refresh" onClick={() => { void ipc.feedRefresh().catch(() => undefined); void refetch(); }}>
              <RefreshCw size={13} />
            </Button>
            <Button variant="brand" size="sm" onClick={() => setCompose(true)}>
              <Plus size={13} /> {t("feed_post")}
            </Button>
          </div>
          <div class="min-h-0 flex-1 overflow-auto">
            <Show when={tab() !== "explore" || indexer()} fallback={<Empty title={t("feed_explore")}>{t("feed_explore_off")}</Empty>}>
              <Show when={!items.error} fallback={<ErrorState error={items.error} onRetry={() => void refetch()} />}>
                <div class="mx-auto max-w-2xl px-4 py-3">
                  <Show when={tab() === "circles"}>
                    <CirclesBar />
                  </Show>
                  <Show when={items()}>
                    {(r) => (
                      <>
                        <Show when={r().kind === "public"}>
                          <Show when={(r().items as FeedItem[]).length} fallback={<Empty title={t("nothing_here")}>{tab() === "friends" ? "Posts from your contacts appear here." : "Follow people from their profile to see their posts here."}</Empty>}>
                            <For each={r().items as FeedItem[]}>{(it) => <PostCard it={it} onOpen={() => navigate(`/feed/${tab()}/${it.id}`)} />}</For>
                          </Show>
                        </Show>
                        <Show when={r().kind === "circles"}>
                          <Show when={(r().items as MergedItem[]).length} fallback={<Empty title="No circle posts yet">Create a Circle above, or wait for one you were added to.</Empty>}>
                            <For each={r().items as MergedItem[]}>{(m) => <CirclePost circle={m.circle} item={m.item} />}</For>
                          </Show>
                        </Show>
                        <Show when={r().kind === "explore"}>
                          <p class="mb-2 text-[11px] text-muted">From the indexer you configured — a read model, not an authority.</p>
                          <For each={r().items as Record<string, unknown>[]} fallback={<Empty title={t("nothing_here")} />}>
                            {(raw) => (
                              <div class="card mb-2 p-3 text-[13px]">
                                <div class="flex items-center gap-2 text-xs text-muted">
                                  <Who address={String(raw.author ?? "")} size="sm" />
                                  <span>{formatMs(Number(raw.timestamp ?? 0) * 1000)}</span>
                                </div>
                                <p class="mt-1 whitespace-pre-wrap selectable">{String((raw.payload as { text?: string } | undefined)?.text ?? raw.text ?? "")}</p>
                              </div>
                            )}
                          </For>
                        </Show>
                      </>
                    )}
                  </Show>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      }>
        {(id) => <PostView id={id()} onBack={() => navigate(`/feed/${tab()}`)} />}
      </Show>
      <ComposeDialog open={compose()} onClose={() => setCompose(false)} defaultCircle={tab() === "circles"} />
    </div>
  );
}

function PostCard(props: { it: FeedItem; onOpen?: () => void; full?: boolean }) {
  const [thread] = createResource(
    () => (props.full ? null : props.it.id),
    (id) => ipc.feedThread(id).catch(() => null),
  );
  const sensitive = () => !!(props.it.payload as { sensitive?: boolean }).sensitive;
  const isMe = () => store.status()?.address === props.it.author;
  const react = async (r: string) => {
    try {
      await ipc.feedReact(props.it.id, r);
      store.bump("feed");
    } catch (e) {
      store.toast(errText(e), "error");
    }
  };
  return (
    <article class="card mb-2 p-3 text-[13px]" data-post={props.it.id}>
      <div class="flex items-center gap-2">
        <Avatar address={props.it.author} size={24} />
        <span class="font-medium">
          <Who address={props.it.author} />
        </span>
        <Show when={props.it.kind === "REPOST"}>
          <Badge>
            <Repeat2 size={10} class="mr-1" /> repost
          </Badge>
        </Show>
        <span class="flex-1" />
        <span class="tnum text-[11px] text-muted" title={formatMs(props.it.timestamp * 1000)}>
          {shortWhen(props.it.timestamp * 1000)}
        </span>
        <Show when={isMe() && props.it.kind === "POST_CREATE"}>
          <button type="button" class="text-muted hover:text-fg" title="Delete post" onClick={async () => { if (await confirm("Delete this post? A tombstone is published; readers hide it.")) { await ipc.feedDelete(props.it.id).catch((e) => store.toast(errText(e), "error")); store.bump("feed"); } }}>
            <Trash2 size={12} />
          </button>
        </Show>
      </div>
      <p class={`mt-2 whitespace-pre-wrap selectable ${props.onOpen ? "cursor-pointer" : ""}`} onClick={props.onOpen}>
        {postText(props.it)}
      </p>
      <Show when={hashtags(props.it).length}>
        <p class="mt-1 text-xs text-brand">{hashtags(props.it).map((h) => `#${h}`).join(" ")}</p>
      </Show>
      <Show when={props.it.media.length}>
        <div class="mt-2 flex flex-wrap gap-2">
          <For each={props.it.media}>{([cid, mime]) => <Media cid={cid} mime={mime} sensitive={sensitive()} />}</For>
        </div>
      </Show>
      <div class="mt-2 flex items-center gap-3 text-xs text-muted">
        <button type="button" class="inline-flex items-center gap-1 hover:text-fg" onClick={() => void react("❤")} title="React">
          <Heart size={12} /> {thread()?.reactions["❤"] ?? ""}
        </button>
        <button type="button" class="inline-flex items-center gap-1 hover:text-fg" onClick={props.onOpen} title="Comments">
          <MessageSquare size={12} /> {thread()?.comments.length ?? ""}
        </button>
        <button type="button" class="inline-flex items-center gap-1 hover:text-fg" title="Repost" onClick={async () => { try { await ipc.feedRepost(props.it.id, ""); store.toast("Reposted"); store.bump("feed"); } catch (e) { store.toast(errText(e), "error"); } }}>
          <Repeat2 size={12} />
        </button>
        <Show when={props.it.visibility !== "public"}>
          <Badge>{props.it.visibility}</Badge>
        </Show>
      </div>
    </article>
  );
}

function PostView(props: { id: string; onBack: () => void }) {
  const [thread, { refetch }] = createResource(
    () => ({ id: props.id, tick: store.ticks().feed }),
    (k) => ipc.feedThread(k.id),
  );
  const [text, setText] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  return (
    <div class="mx-auto w-full max-w-2xl overflow-auto px-4 py-3">
      <button type="button" class="mb-2 text-xs text-muted hover:text-fg" onClick={props.onBack}>
        ← back
      </button>
      <Show when={!thread.error} fallback={<ErrorState error={thread.error} onRetry={() => void refetch()} />}>
        <Show when={thread()} fallback={<p class="text-xs text-muted">{thread.loading ? t("loading") : "Post not found or not fetched yet."}</p>}>
          {(th) => (
            <>
              <PostCard it={th().post} full />
              <Show when={Object.keys(th().reactions).length}>
                <p class="mb-2 text-xs text-muted">
                  <For each={Object.entries(th().reactions)}>{([r, n]) => <span class="mr-2">{r} {n}</span>}</For>
                </p>
              </Show>
              <div class="mb-3 flex items-center gap-2">
                <Input value={text()} onInput={(e) => setText(e.currentTarget.value)} placeholder="Write a comment…" onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void submit()} />
                <Button size="sm" loading={busy()} disabled={!text().trim()} onClick={() => void submit()}>
                  <Send size={12} />
                </Button>
              </div>
              <For each={th().comments} fallback={<p class="text-xs text-muted">No comments yet.</p>}>
                {(c) => (
                  <div class="mb-1.5 rounded-md border border-border px-3 py-2 text-[13px]">
                    <div class="flex items-center gap-2 text-xs text-muted">
                      <Who address={c.author} size="sm" />
                      <span>{shortWhen(c.timestamp * 1000)}</span>
                    </div>
                    <p class="mt-0.5 whitespace-pre-wrap selectable">{postText(c)}</p>
                  </div>
                )}
              </For>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
  async function submit() {
    if (!text().trim()) return;
    setBusy(true);
    try {
      await ipc.feedComment(props.id, text());
      setText("");
      store.bump("feed");
    } catch (e) {
      store.toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  }
}

// ---------------------------------------------------------------------------
// Circles
// ---------------------------------------------------------------------------

function CirclesBar() {
  const [circles, { refetch }] = createResource(
    () => store.ticks().circles,
    () => ipc.circlesList().catch(() => [] as CircleInfo[]),
  );
  const [create, setCreate] = createSignal(false);
  const [manage, setManage] = createSignal<CircleInfo | null>(null);
  return (
    <div class="mb-3 flex flex-wrap items-center gap-1.5">
      <For each={circles() ?? []}>
        {(c) => (
          <button type="button" class="badge-strong h-6 px-2.5 hover:border-brand" title={`${c.members.length} members${c.owner ? " · you created it" : ""}`} onClick={() => setManage(c)}>
            <Users size={10} class="mr-1" /> {c.name} · {c.members.length}
          </button>
        )}
      </For>
      <Button variant="ghost" size="sm" onClick={() => setCreate(true)}>
        <Plus size={12} /> New Circle
      </Button>
      <CreateCircleDialog open={create()} onClose={() => { setCreate(false); void refetch(); }} />
      <ManageCircleDialog circle={manage()} onClose={() => { setManage(null); void refetch(); }} />
    </div>
  );
}

function CreateCircleDialog(props: { open: boolean; onClose: () => void }) {
  const [name, setName] = createSignal("");
  const [desc, setDesc] = createSignal("");
  const [members, setMembers] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  return (
    <Dialog open={props.open} onClose={props.onClose} title="New Circle" description="A private group. Posts travel encrypted to the members' devices and nowhere else." width="max-w-md">
      <div class="flex flex-col gap-3">
        <Field label="Name">
          <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} maxLength={128} />
        </Field>
        <Field label="Description">
          <Input value={desc()} onInput={(e) => setDesc(e.currentTarget.value)} maxLength={512} />
        </Field>
        <Field label="Members" hint="@names or addresses, comma-separated. Each must have a device on chain.">
          <Input value={members()} onInput={(e) => setMembers(e.currentTarget.value)} placeholder="@alice, @bob" />
        </Field>
        <Show when={error()}>
          <Notice strong>{error()}</Notice>
        </Show>
        <div class="flex justify-end">
          <Button
            loading={busy()}
            disabled={!name().trim() || !members().trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await ipc.circlesCreate(name(), desc(), splitRecipients(members()));
                store.toast("Circle created");
                store.bump("circles", "feed");
                setName(""); setDesc(""); setMembers("");
                props.onClose();
              } catch (e) {
                setError(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Create
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ManageCircleDialog(props: { circle: CircleInfo | null; onClose: () => void }) {
  const [add, setAdd] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const me = () => store.status()?.address;
  const act = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await f();
      if (done) store.toast(done);
      store.bump("circles", "feed");
    } catch (e) {
      store.toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!props.circle} onClose={props.onClose} title={props.circle?.name ?? ""} description={props.circle?.description} width="max-w-md">
      <Show when={props.circle}>
        {(c) => (
          <div class="flex flex-col gap-3">
            <ul class="card divide-y divide-border">
              <For each={c().members}>
                {(m) => (
                  <li class="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                    <span class="flex-1"><Who address={m} /></span>
                    <Show when={m !== me()}>
                      <Button variant="ghost" size="sm" disabled={busy()} onClick={() => act(() => ipc.circlesRemoveMember(c().id, m), "Removed")}>
                        <X size={12} />
                      </Button>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <div class="flex items-center gap-2">
              <Input value={add()} onInput={(e) => setAdd(e.currentTarget.value)} placeholder="@name or address" />
              <Button size="sm" variant="secondary" disabled={!add().trim() || busy()} onClick={() => act(() => ipc.circlesAddMember(c().id, add()).then(() => setAdd("")), "Added")}>
                <UserPlus size={12} /> Add
              </Button>
            </div>
            <p class="text-[11px] text-muted">Adding a member starts a new encryption epoch: they do not see earlier posts. Any member may add members; Circles have no roles.</p>
            <div class="flex justify-end">
              <Button variant="danger" size="sm" disabled={busy()} onClick={async () => { if (await confirm(`Leave "${c().name}"?`)) { await act(() => ipc.circlesLeave(c().id), "Left the circle"); props.onClose(); } }}>
                Leave circle
              </Button>
            </div>
          </div>
        )}
      </Show>
    </Dialog>
  );
}

export function CirclePost(props: { circle: string; item: CircleItemView }) {
  const [comments, { refetch }] = createResource(
    () => ({ c: props.circle, p: props.item.id, tick: store.ticks().circles }),
    (k) => ipc.circlesComments(k.c, k.p).catch(() => [] as CircleItemView[]),
  );
  const [text, setText] = createSignal("");
  const [showComments, setShowComments] = createSignal(false);
  const [voted, setVoted] = createSignal<number[]>([]);
  const isMe = () => store.status()?.address === props.item.author;
  const totalVotes = createMemo(() => Object.values(props.item.votes).reduce((a, b) => a + b, 0));
  const act = async (f: () => Promise<unknown>) => {
    try {
      await f();
      store.bump("circles", "feed");
      void refetch();
    } catch (e) {
      store.toast(errText(e), "error");
    }
  };
  return (
    <article class={`card mb-2 p-3 text-[13px] ${props.item.deleted ? "opacity-50" : ""}`} data-circle-post={props.item.id}>
      <div class="flex items-center gap-2">
        <Avatar address={props.item.author} size={24} />
        <span class="font-medium"><Who address={props.item.author} /></span>
        <Badge brand title="private circle post">circle</Badge>
        <span class="flex-1" />
        <span class="tnum text-[11px] text-muted">{shortWhen(props.item.at_ms)}</span>
        <Show when={isMe() && !props.item.deleted}>
          <button type="button" class="text-muted hover:text-fg" title="Delete" onClick={() => void act(() => ipc.circlesDelete(props.circle, props.item.id))}>
            <Trash2 size={12} />
          </button>
        </Show>
      </div>
      <p class="mt-2 whitespace-pre-wrap selectable">{props.item.deleted ? "(deleted)" : props.item.text}</p>
      <Show when={props.item.media.length}>
        <div class="mt-2 flex flex-wrap gap-2">
          <For each={props.item.media}>{(m, i) => <CircleMedia circle={props.circle} item={props.item.id} index={i()} mime={m.mime} />}</For>
        </div>
      </Show>
      <Show when={props.item.poll}>
        {(poll) => (
          <div class="mt-2 rounded-md border border-border p-2" data-poll>
            <p class="mb-1 flex items-center gap-1 font-medium">
              <Vote size={12} /> {poll().question}
            </p>
            <For each={poll().options}>
              {(o, i) => {
                const n = () => props.item.votes[String(i())] ?? 0;
                const pct = () => (totalVotes() ? Math.round((n() / totalVotes()) * 100) : 0);
                return (
                  <button
                    type="button"
                    class="relative mb-1 flex w-full items-center justify-between overflow-hidden rounded border border-border px-2 py-1 text-left text-xs hover:border-brand"
                    onClick={() => {
                      const next = poll().multiple_choice ? (voted().includes(i()) ? voted().filter((x) => x !== i()) : [...voted(), i()]) : [i()];
                      setVoted(next);
                      void act(() => ipc.circlesVote(props.circle, props.item.id, next));
                    }}
                    data-option={i()}
                  >
                    <span class="absolute inset-y-0 left-0 bg-surface-2" style={{ width: `${pct()}%` }} aria-hidden="true" />
                    <span class="relative">{o}</span>
                    <span class="tnum relative text-muted" data-votes={n()}>
                      {n()} · {pct()}%
                    </span>
                  </button>
                );
              }}
            </For>
            <p class="text-[11px] text-muted">
              {totalVotes()} vote{totalVotes() === 1 ? "" : "s"}
              {poll().multiple_choice ? " · multiple choice" : ""}
              {poll().closes_at_ms ? ` · closes ${formatMs(poll().closes_at_ms)}` : ""}
            </p>
          </div>
        )}
      </Show>
      <div class="mt-2 flex items-center gap-3 text-xs text-muted">
        <button type="button" class="inline-flex items-center gap-1 hover:text-fg" onClick={() => void act(() => ipc.circlesReact(props.circle, props.item.id, "❤"))}>
          <Heart size={12} /> {props.item.reactions["❤"] ?? ""}
        </button>
        <button type="button" class="inline-flex items-center gap-1 hover:text-fg" onClick={() => setShowComments((v) => !v)}>
          <MessageSquare size={12} /> {comments()?.length ?? ""}
        </button>
      </div>
      <Show when={showComments()}>
        <div class="mt-2 border-t border-border pt-2">
          <For each={comments() ?? []}>
            {(c) => (
              <div class="mb-1 text-xs">
                <span class="mr-1 font-medium"><Who address={c.author} size="sm" /></span>
                <span class="selectable">{c.deleted ? "(deleted)" : c.text}</span>
              </div>
            )}
          </For>
          <div class="mt-1 flex items-center gap-2">
            <Input class="h-7" value={text()} onInput={(e) => setText(e.currentTarget.value)} placeholder="Comment…" onKeyDown={(e) => e.key === "Enter" && text().trim() && void act(() => ipc.circlesComment(props.circle, props.item.id, text()).then(() => setText("")))} />
          </div>
        </div>
      </Show>
    </article>
  );
}

function CircleMedia(props: { circle: string; item: string; index: number; mime: string }) {
  const [src] = createResource(
    () => (props.mime.startsWith("image/") ? `${props.item}/${props.index}` : null),
    () => ipc.circlesMediaFetch(props.circle, props.item, props.index).then(convertFileSrc).catch(() => null),
  );
  return (
    <Show when={props.mime.startsWith("image/")} fallback={<Badge>{props.mime}</Badge>}>
      <Show when={src()} fallback={<div class="skeleton h-32 w-48" />}>
        <img src={src()!} alt="" class="max-h-80 rounded-md border border-border object-contain" />
      </Show>
    </Show>
  );
}

function ComposeDialog(props: { open: boolean; onClose: () => void; defaultCircle?: boolean }) {
  const [text, setText] = createSignal("");
  const [tags, setTags] = createSignal("");
  const [media, setMedia] = createSignal<string[]>([]);
  const [sensitive, setSensitive] = createSignal(false);
  const [target, setTarget] = createSignal<string>("public");
  const [poll, setPoll] = createSignal(false);
  const [question, setQuestion] = createSignal("");
  const [options, setOptions] = createSignal<string[]>(["", ""]);
  const [multi, setMulti] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [circles] = createResource(
    () => (props.open ? store.ticks().circles : null),
    () => ipc.circlesList().catch(() => [] as CircleInfo[]),
  );
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (target() === "public") {
        await ipc.feedPost(text(), tags().split(/[\s,#]+/).filter(Boolean), media(), sensitive());
        store.bump("feed");
      } else {
        const p: PollInput | undefined = poll() ? { question: question(), options: options().filter((o) => o.trim()), multiple_choice: multi(), closes_at_ms: 0 } : undefined;
        await ipc.circlesPost(target(), text(), media(), p);
        store.bump("circles", "feed");
      }
      store.toast("Posted");
      setText(""); setTags(""); setMedia([]); setSensitive(false); setPoll(false); setQuestion(""); setOptions(["", ""]);
      props.onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={props.open} onClose={props.onClose} title={t("feed_post")} width="max-w-lg">
      <div class="flex flex-col gap-3">
        <Select
          value={target()}
          onChange={setTarget}
          aria-label="audience"
          options={[{ value: "public", label: "Public — everyone on the network" }, ...((circles() ?? []).map((c) => ({ value: c.id, label: `Circle: ${c.name} (${c.members.length})` })))]}
        />
        <Show when={props.defaultCircle && !(circles() ?? []).length}>
          <Notice>You have no Circles yet. Create one from the Circles tab to post privately.</Notice>
        </Show>
        <Textarea value={text()} onInput={(e) => setText(e.currentTarget.value)} rows={5} placeholder={target() === "public" ? "Say something to everyone…" : "Say something to the circle…"} maxLength={64 * 1024} />
        <Show when={target() === "public"}>
          <Field label="Hashtags">
            <Input value={tags()} onInput={(e) => setTags(e.currentTarget.value)} placeholder="#hashgram #mainnet" />
          </Field>
          <Checkbox checked={sensitive()} onChange={setSensitive} label="Sensitive media" hint="Readers click before media shows." />
        </Show>
        <Show when={target() !== "public"}>
          <Checkbox checked={poll()} onChange={setPoll} label="Add a poll" />
          <Show when={poll()}>
            <div class="card flex flex-col gap-2 p-3" data-testid="poll-builder">
              <Input value={question()} onInput={(e) => setQuestion(e.currentTarget.value)} placeholder="Question" />
              <For each={options()}>
                {(o, i) => (
                  <div class="flex items-center gap-1">
                    <Input value={o} onInput={(e) => setOptions(options().map((x, j) => (j === i() ? e.currentTarget.value : x)))} placeholder={`Option ${i() + 1}`} />
                    <Show when={options().length > 2}>
                      <Button variant="ghost" size="icon-sm" onClick={() => setOptions(options().filter((_, j) => j !== i()))}>
                        <X size={12} />
                      </Button>
                    </Show>
                  </div>
                )}
              </For>
              <div class="flex items-center gap-2">
                <Button variant="ghost" size="sm" disabled={options().length >= 12} onClick={() => setOptions([...options(), ""])}>
                  <Plus size={12} /> option
                </Button>
                <Checkbox checked={multi()} onChange={setMulti} label="Multiple choice" />
              </div>
            </div>
          </Show>
        </Show>
        <div class="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={media().length >= 20} onClick={async () => { const f = await pickFile({ multiple: true, filters: [{ name: "Media", extensions: ["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "mp3", "m4a"] }] }); setMedia([...media(), ...f].slice(0, 20)); }}>
            <ImageIcon size={12} /> Media ({media().length}/20)
          </Button>
          <span class="truncate text-xs text-muted">{media().map((m) => m.split(/[\\/]/).pop()).join(", ")}</span>
        </div>
        <Show when={error()}>
          <Notice strong>{error()}</Notice>
        </Show>
        <div class="flex items-center justify-between">
          <span class="text-[11px] text-muted">
            <Show when={target() === "public"} fallback={<><Eye size={10} class="mr-1 inline" />Encrypted to the circle's members only.</>}>
              Public and signed by your device key. Anyone can read it; you can delete it later (a tombstone).
            </Show>
          </span>
          <Button loading={busy()} disabled={!text().trim() && !media().length && !(poll() && question().trim())} onClick={submit}>
            <Send size={12} /> {t("feed_post")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
