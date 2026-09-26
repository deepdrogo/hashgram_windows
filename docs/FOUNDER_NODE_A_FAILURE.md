# If the founder's original server is permanently deleted today

The question this document answers, traced to code and configuration
rather than to intent: **the genesis VPS at `186.241.19.230` is destroyed
and never comes back, while a second Hashgram node exists somewhere else.
What keeps working?**

The short version: **the chain stops, and most of the social network keeps
running for people who are already using it, but nobody new can find the
network.** The three failures are independent and have three different
fixes.

## The three single points of failure

### 1. One validator holds all the voting power

`app/params/mainnet/genesis.json` contains exactly one
`MsgCreateValidator` in `genutil.gen_txs` — `genesis-full`, self-delegating
`900000000000 uhash` (900,000 HASH), with `186.241.19.230:26656` in its
memo. No other validator was bonded at launch.

CometBFT finalises a block when more than two thirds of bonded voting power
signs it. With one validator that is 100 % of the power on one machine: if
it disappears, no block is ever produced again. Not slowly, not degraded —
the chain stops at the last height it reached.

Nothing in the client can fix this. The fix is operational: bond at least
one more validator, run by someone else, before it matters. Two validators
each with half the stake still halt if either goes away (½ < ⅔), so the
target is four or more independent validators, no one of which holds more
than a third.

### 2. Bootstrap addresses point at one host

`app/params/mainnet/bootstrap_peers.txt` has two lines, a QUIC and a TCP
address for the same peer id on the same IP. `app/params/mainnet/seeds.txt`
has one CometBFT seed, the same host. `dns_seeds.txt` now carries
`bootstrap.hashgram.io`, but until that TXT record is published it resolves
to nothing.

A client that has been online before does not care: `peerstore.json`
remembers the nodes it met, Kademlia keeps finding more, and peer exchange
fills the gaps (`node/hashgram-p2p/src/swarm.rs`). A **fresh install** has
none of that. It tries the compiled-in addresses, finds nothing, and stays
offline for ever — the app shows "Connecting" and retries with a growing
pause, correctly and uselessly.

The fix has two halves and both are operational: more bootstrap lines from
independent operators in the next build, and a published
`_dnsaddr.bootstrap.hashgram.io` TXT record, which is the one layer that
can be repointed without shipping a binary.

### 3. The indexer, if it only ran there

The indexer is a derived read model: `hashgramctl indexer rebuild`
reconstructs it from nodes and the chain, and every number it serves is
recomputable by a client. Losing it is not data loss. It is, however, how
this app answers "how many followers", "search users" and "search
hashtags", because those are the questions that need an index over
*everybody's* events rather than one author's chain.

Since this release the desktop accepts several indexer URLs and tries them
in order (`Settings.indexers()`), so a second one anywhere removes this
point of failure entirely.

## Subsystem by subsystem

Assumption: the surviving node runs the `store`, `media` and `relay` roles
and is reachable. "Works" means for a client that has been online before.

| Subsystem | Result | Why |
| --- | --- | --- |
| Block production | **BROKEN** | Single bonded validator, `genesis.json` gen_txs |
| Transactions | **BROKEN** | Nothing to include them in a block |
| Wallet — keys, signing, balances already read | **WORKS** | Keys are local; the vault never needed the network |
| Wallet — sending, staking, new balances | **BROKEN** | Needs a chain to accept a transaction |
| Username resolution | **BROKEN** for new lookups, **WORKS** from cache | `x/username` lives on the chain; `people_state.cache` holds 10 minutes |
| Identity / device authority | **DEGRADED** | Nodes cache chain answers for ten minutes; after that an event whose author they cannot verify is *ignored*, not rejected (`node/hashgram-node/src/social.rs`) — so posting stops working network-wide once caches expire |
| Pulse — Following, Friends | **WORKS** | Replayed from cached signed events; refreshed from any node with the author's log |
| Pulse — Latest | **WORKS** | `EventFetch` timeline from any node that has the events |
| Profiles | **WORKS** | Latest `PROFILE_UPDATE` from any node, verified locally |
| Profile follower counts, user search, hashtag search | **DEGRADED** | Needs an indexer; the app already says "unknown" rather than zero |
| Posts and comments | **WORKS** to read; **BROKEN** to publish once device-authority caches expire | See identity above |
| Photos and videos | **DEGRADED** | The blob has to be on a surviving provider. Uploads target three; a node's repair pass copies towards three; neither is proof. A file uploaded shortly before the loss may have had one copy |
| Stories | **WORKS** while they last | Same as posts and media |
| Topics and channels | **WORKS** | Ordinary social events on the gossip shards |
| Chats — live | **WORKS** | MLS between devices over any P2P path; no server in the middle |
| Chats — offline delivery | **WORKS** | Mailboxes are per store node and delivery targets up to three; one surviving store is enough |
| Mail — live and offline | **WORKS** | Same transport as Chats |
| Mail — external `@hashgram.io` | **BROKEN** | The gateway ran there |
| Drive | **DEGRADED** | Manifests are in the local encrypted store and sync between the user's devices; the ciphertext must be on a surviving provider, same caveat as media |
| Spaces | **WORKS** | MLS groups, same as Chats |
| Bootstrap for existing installs | **WORKS** | `peerstore.json`, Kademlia, peer exchange |
| Bootstrap for new installs | **BROKEN** | One host in the compiled list, no DNS record yet |
| Relay and TURN | **DEGRADED** | Whatever roles the surviving node runs |
| Running your own node | **WORKS** | It just needs a peer; the chain gateway it proxies to is dead, which stops receipt signing |

## What this release changed, and what it could not

Changed in code:

- the desktop accepts several indexer URLs and falls through them, so one
  indexer is no longer a single point of discovery failure;
- `dns_seeds.txt` ships a name, so bootstrap can be repointed by DNS rather
  than by a new installer;
- public media uploads target three providers instead of two, matching the
  `TARGET_REPLICAS` a node repairs towards — under-uploading was how a
  photo quietly ended up with one copy;
- Drive shows measured availability and says which nodes answered, so
  "this file is on one machine" is visible instead of assumed.

Not changed, deliberately:

- **consensus.** Adding validators is a governance and operations act, not
  a UI change, and doing it blind from a desktop release would be
  reckless. `docs/DECENTRALIZATION.md` says what has to happen.

## The operational checklist

1. Bond three or more validators, run by different people on different
   infrastructure, so no operator holds a third of the stake.
2. Publish `_dnsaddr.bootstrap.hashgram.io` TXT records for every
   long-lived node.
3. Add those nodes to `bootstrap_peers.txt` and `seeds.txt` in the next
   build.
4. Run a second indexer and put both URLs in the app's defaults.
5. Run the mail gateway somewhere other than the validator.
6. Check `docs/DISASTER_RECOVERY.md` before, not after.

Until 1 and 2 are done, the honest description of Hashgram Mainnet is: a
decentralised protocol with a centralised launch, one machine away from a
halted chain and from being unreachable by anyone new. Everything above
that line — social, chat, mail, drive, between people already connected —
is genuinely peer-to-peer today.
