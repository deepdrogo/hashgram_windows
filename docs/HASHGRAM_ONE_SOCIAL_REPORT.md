# Hashgram One: from a workspace to a social network

What changed between 0.3.1 and 1.0.0, why, and what is still true about
the things it cannot fix. Written for the next person to work on this.

## 1. Architecture, before and after

**Before.** Nine sections of equal weight opening on Mail. Public social
life was split between two screens that did overlapping jobs — Hashwall
(friends, following, walls, circles) and Explore (posts, walls, people,
tags, plus a HASH rich list and a provider table). A profile was account
metadata with an activity score. Private conversation existed only as mail.
Media was a single image per post with no size, no poster and no viewer.
Stories, reels, banners and profile attributes existed in the protocol and
in nothing else.

**After.** Social first: Pulse, Chats, Mail, Drive, Spaces, Contacts, then
Wallet, Earn, Network, then My profile and Settings. Pulse is the home
screen. Profiles are social identities with a wall. Chats are real. Media
has a pipeline. Stories exist. The rich list and the provider table are in
Network, where infrastructure belongs.

Nothing was reimplemented below the UI. Every screen still goes through
typed Tauri commands into `hashgram_sdk`, and the crypto, the MLS groups
and the P2P transport are untouched.

## 2. Files

New (frontend): `routes/pulse/Pulse.tsx`, `routes/topics/Topics.tsx`,
`routes/chats/Chats.tsx`, `routes/profile/{Profile,ProfileEdit,FollowList,Username}.tsx`,
`components/social/{DiscoveryRail,Stories,Media}.tsx`,
`components/network/{Registries,YourNode}.tsx`, `lib/{nav,uistate,mediameta}.ts`.

New (Rust): `cmd_profile.rs`, `cmd_chat.rs`, `media.rs`,
`node_supervisor.rs`.

Deleted: `routes/Explore.tsx` (split between Pulse and Network) and
`src-tauri/src/commands_node.rs` (a duplicate that was never compiled).

Substantially changed: `App.tsx`, `Shell.tsx`, `CommandPalette.tsx`,
`Feed.tsx`, `Network.tsx`, `Mail.tsx`, `People.tsx`, `Drive.tsx`,
`Settings.tsx`, `lib/{ipc,store,i18n}.ts`; `lib.rs`, `state.rs`,
`session.rs`, `settings.rs`, `db.rs`, `views.rs`, `cmd_feed.rs`,
`cmd_drive.rs`, `cmd_earn.rs`, `winsec.rs`; SDK `feed.rs`, `people.rs`,
`blob.rs`, `drive.rs`.

New docs: `STORIES.md`, `FOUNDER_NODE_A_FAILURE.md`, this file.

## 3. Pulse

`/pulse/:tab?/:id?` with Latest, Following, Topics and Local, a Stories row
and a discovery column. Latest and Local page from the nearest node over
`EventFetch`; Following replays cached signed events and works offline;
Topics is the channel index. `/pulse/post/<id>` and `/pulse/tag/<name>` are
the same screen.

No ranking anywhere. `tests/pulse.test.ts` fails the build if the words
rank, score, recommend or algorithm appear in the code.

## 4. Profiles

`/profile/<address>` for anyone, `/profile/me` for yourself. Cover, avatar,
display name, @username, address, bio, website, country, join date,
follower and following counts, Follow / Chat / Mail, and four tabs over the
author's own events: Posts, Replies, Media, Likes.

## 5. Avatars and 6. Covers

Both are public blobs referenced by CID from `PROFILE_UPDATE`. The protocol
always had `avatar_cid` and `banner_cid`; the SDK only wrote the first.
`update_profile_full` writes name, bio, avatar, banner, website and a
country attribute. `profile_upload_image` uploads and returns a CID so the
editor previews before anything is signed.

## 7. The personal wall

`Feed::author_tab` filters the author's cached log: Posts is
`POST_CREATE` without `reply_to` plus `REPOST` and `REEL_CREATE`; Replies
is `COMMENT_CREATE` and replies; Media is posts carrying media; Likes is
standing `REACTION`s, with withdrawn ones removed rather than shown as
history. `refresh_author` pulls forward from a per-author sequence cursor,
so a profile opens offline and fills in when online.

## 8. Followers and following

Following is replayed from the person's own FOLLOW/UNFOLLOW events — no
index needed, right offline. Followers is the reverse direction, which
nothing an account signs records, so it is `Option<u32>` from the SDK
through the view to TypeScript and renders as "unknown" without an
indexer. That is the shape of the honesty rule in this release: the type
system carries the uncertainty instead of a zero pretending to be a fact.

## 9-11. Photos, video and the media gallery

`feed_post_media` reads each file, measures it, uploads it as its own
public blob and only then signs the event. Pictures are decoded in Rust
with the `image` crate for real dimensions and a 640px thumbnail. Video is
not decoded: the webview measures it with the decoder it already has and
supplies one frame, which Rust re-encodes before storing. No transcoder
ships and no upload service exists. Progress goes out on `media:progress`
as Preparing, Uploading n of m, Publishing, Published or Failed.

Tiles load on approach with a 300px margin. Profile Media is a view over
posts, not a second library.

## 12-13. Stories

`STORY_CREATE` with the author's own `expires_at`, default 24 hours,
protocol maximum 48. A row at the top of Pulse, a fullscreen viewer with
progress bars, arrows, pause and a tap through to the profile.

**Expiry is a display rule, not deletion**, and `docs/STORIES.md` sets out
exactly what a user may be told: active surfaces stop showing it and
indexes stop serving it, the event stays in node logs until the 90-day
sweep, and the media blob has no expiry at all. The composer says this
before the user posts. `tests/stories.test.ts` greps the whole frontend for
"disappears" and "deleted after N hours". No view count, because counting
viewers means every viewer reporting that they watched.

## 14. Topics

Channels, called Topics in every string the user reads. `/topics/<id>` is a
page; the Topics tab in Pulse is the index of pinned and recently active
ones. The protocol keeps saying channel.

## 15. Chats

SolidJS → `cmd_chat.rs` → `messaging.rs` (MLS) → mailboxes on store nodes.
History lives in the sealed SQLite cache: text encrypted under the vault
key with the message id as associated data, only ids, sender and time
readable. A message is stored before it is sent, so it appears instantly
and survives being offline; "waiting" means this device still has it,
"sent" means a store node took it, and nothing claims the other person read
it.

Who may chat is enforced in `accept_incoming`, on the **receiving** side,
because a sender's client can be told anything. Everyone or Nobody, with
blocking overriding both, and room for "people I follow" without changing a
caller.

## 16-17. Mail and Drive

Mail shows the address people write to — `@name` and `name@hashgram.io` —
where a mail client puts it, and offers "Choose a username" when there is
none, leading to My profile rather than the wallet. Drive's file dialog
asks the providers it can reach whether they hold the content and reports
what answered against the target of three; when nothing answers it says
unknown. There is no Healthy badge.

## 18. Run Node

Rewritten. `node_supervisor.rs` spawns the node as a child with
`CREATE_NO_WINDOW`, pipes its output into a bounded buffer, keeps the pid,
and derives a state from evidence: NotInstalled, Stopped, Starting,
Connecting, Syncing, Running, Degraded, Stopping, Crashed, Error. Spawned
is not Running — nothing says Running until the node reports peers.
Pre-flight checks the program, the configuration, a writable folder, disk
space and port 26670 before spawning, and a blocked start explains itself.
Network → Your node is the dashboard, with a log viewer. The Scheduled Task
and service remain for starting at logon.

## 19-22. Resilience

Traced in full in [`FOUNDER_NODE_A_FAILURE.md`](FOUNDER_NODE_A_FAILURE.md).
Three single points of failure: one bonded validator with all the voting
power, one bootstrap host, one indexer. The last two are mitigated here — a
DNS seed name ships and the app takes a list of indexers — and the first
cannot be fixed by a desktop release.

Public media now uploads to three providers, matching the node's own
`TARGET_REPLICAS`; it was two, which is how a photo quietly ended up with
one copy.

**If the founder's original server is permanently deleted today:** the
chain stops and with it transactions, sending, staking and new username
lookups; new installs cannot find the network; follower counts and public
search stop unless a second indexer is configured. Feeds, profiles,
topics, stories, chats, mail, drive and spaces keep working between people
who are already connected, because none of that goes through that machine.

## 23-24. Tests

Added: `navigation`, `profile`, `pulse`, `media`, `stories`, `chats`,
`identity-drive`, `node`, `resilience`, `theme` (frontend, 117 assertions
in 12 files); story expiry and tamper cases in `sdk/feed.rs`; chat storage,
ordering, unread, queue and search in `db.rs`; media measurement in
`media.rs`; supervisor state and pre-flight in `node_supervisor.rs`.

Run every time: `pnpm exec tsc --noEmit`, `pnpm test`,
`cargo test -p hashgram-desktop` (including `no_plaintext`),
`cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all`.

The pre-existing security tests were not weakened. `forbidden-fields`
gained the new view types; `rules` kept every constraint and changed only
the expected rail order.

## 25. Known limitations

- **One validator.** The chain halts if it stops. Operations, not code.
- **DNS seed not published.** The name ships; the TXT record does not
  exist yet, so it currently resolves to nothing.
- **Followers need an indexer.** Honest, but a gap.
- **Replication is best-effort.** Three providers are targeted and a node
  repairs towards three; nothing proves three copies exist, and the UI
  says what answered rather than what is.
- **Stories have no viewer count** and no reactions or replies yet. The
  event family supports both.
- **Chat is one-to-one.** MLS handles groups and the code does not expose
  them yet. Attachments go through the same MLS channel but have no UI.
- **Go dependency advisories** (`govulncheck`) are untouched: there was no
  Go toolchain available to verify a bump against.
- **Video has no transcoding**, deliberately. A file a browser cannot play
  will not play here either.
- **Local is coarse.** It filters Latest by the author's declared country,
  so it depends on people filling that in.
