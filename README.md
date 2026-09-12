# Hashgram

A decentralised network with a fixed supply, a finite reward reserve and no
central point of control.

## Hashgram One

**One identity. One inbox. One vault. One network.**

Hashgram One is the consumer product built on this network: private
communication and storage where the blockchain and the libp2p swarm are
infrastructure and the user-facing concepts are

| | |
| --- | --- |
| **Mail** | end-to-end encrypted HashMail between `hash1…` identities, `@alice`, `alice@hashgram.io`; threads, BCC, receipts, local spam policy — [docs/HASHMAIL.md](docs/HASHMAIL.md) |
| **Drive** | HashDrive: client-encrypted, segmented, versioned files with an encrypted manifest tree, multi-device merge and capability sharing — [docs/HASHDRIVE.md](docs/HASHDRIVE.md) |
| **People** | chain-resolved identities, contact requests over MLS, friend/block/mute/trust state that never leaves your devices |
| **Feed** | public signed posts plus private Circle posts merged client-side |
| **Spaces** | MLS groups with a signed, hash-chained role log (Owner/Admin/Member/Guest), space drive and space mail — [docs/SPACES.md](docs/SPACES.md) |
| **Earn** | the `x/serviceproof` provider lifecycle as an application API |
| **Wallet** | HASH balances and transfers through the chain relay |
| **Network** | validators, providers, leaderboards and stats from the indexer |

Everything cryptographic lives in Rust (`node/hashgram-app`,
`sdk/rust/hashgram-sdk`); every application payload travels inside MLS
ciphertext that no node, relay, store or indexer decodes. Architecture and
what is and is not built: [docs/HASHGRAM_ONE_ARCHITECTURE.md](docs/HASHGRAM_ONE_ARCHITECTURE.md);
baseline audit: [docs/HASHGRAM_ONE_AUDIT.md](docs/HASHGRAM_ONE_AUDIT.md);
sync model: [docs/SYNC_ENGINE.md](docs/SYNC_ENGINE.md); privacy:
[docs/PRIVACY_MODEL.md](docs/PRIVACY_MODEL.md).

## The repository

This repository holds Hashgram Core: the blockchain, the peer-to-peer node,
the application protocol and client SDK, the indexer, the safety engine, the
operator tooling and the genesis machinery. **Phases 1 and 2 are complete and
run**: chain, E2EE messaging, social events, media storage, useful-service
rewards, calls infrastructure. **Mainnet `hashgram-1` launched on
2026-09-10** (genesis hash
`e322bc2319f6e0173286fa526dab5a8ff8ad0797c7b80dd03e7c9d98621d5e4d`). A
Windows desktop application exists in `apps/desktop` (Tauri 2 + SolidJS,
v0.1.1) and is being superseded by the Hashgram One desktop specified in
`docs/DESKTOP_APP_MASTER_PROMPT.md`. See [Status](#status) for exactly what
exists.

## What is different about it

Most of these are claims any chain can make. Each one below links to the code
that enforces it and the test that proves it, because a claim in a README is
worth nothing on its own.

**There is no inflation, and not because a parameter is set to zero.** The
`x/mint` module is not wired into the application at all. A parameter set to
zero can be changed by a governance proposal; a module that is absent requires
a new binary the validator set has to adopt. Every uhash that will ever exist
is created in the genesis block.
[`app/app.go`](app/app.go) ·
[`app/app_test.go`](app/app_test.go) asserts no module holds the minter
permission.

**The Founder's 1% is a share of protocol fee revenue, never a tax on
transfers.** If you send someone 100 HASH they receive exactly 100 HASH. The
Founder share applies only to fees the protocol itself has already collected,
and it is capped at 100 basis points by a compile-time constant that
governance cannot raise.
[`x/founder`](x/founder) · [`x/feerouter`](x/feerouter) ·
[`x/feerouter/keeper/route_test.go`](x/feerouter/keeper/route_test.go)

**Rewards for useful work, not for wasted electricity.** Storage providers are
paid on bytes the network assigned to them and challenges they answered. Relay
and call providers are paid on receipts the served client signed. A node that
reports its own traffic earns nothing, and a pair of nodes trading fake
receipts is discounted to 20% of what they claim.
[`x/serviceproof`](x/serviceproof)

**The reward reserve is finite and cannot be topped up.** 500,000,000 HASH at
genesis, spent on a declining schedule that takes a fixed fraction of what
remains each epoch. It asymptotes rather than hitting a cliff, and when it is
low, operators are funded by real service revenue instead of subsidy.
[`x/serviceproof/types/emission.go`](x/serviceproof/types/emission.go)

**A fork of this software is a different network, and the code says so.**
Network identity is five parts: name, network id, chain id, genesis hash and a
four-byte magic. Signatures are domain-separated by network, so an attestation
issued on one Hashgram network cannot be replayed on another.
[`x/network`](x/network) · [`app/params/network.go`](app/params/network.go)

**No master key, no kill switch, no override.** There is no administrative
transaction that can freeze an account, reverse a transfer, mint a coin or
change the supply. Treasury spending requires a governance proposal and leaves
a disbursement record.
[docs/DECENTRALIZATION.md](docs/DECENTRALIZATION.md)

## Status

| Component | State |
| --- | --- |
| Blockchain (Cosmos SDK v0.53, CometBFT v0.38) | Runs. Devnet and a four-validator testnet both pass. |
| Eight custom modules | Implemented and tested. |
| Genesis tooling, `hashgramctl`, `hashgram-keygen` | Complete. |
| Prometheus metrics, Grafana dashboards, alerts | Complete and verified against a running node. |
| CI: tests, staticcheck, gosec, gitleaks, govulncheck | Green. |
| Reproducible release build | Verified byte-identical. |
| Mainnet | **Launched 2026-09-10.** Chain id `hashgram-1`, genesis hash `e322bc2319f6e0173286fa526dab5a8ff8ad0797c7b80dd03e7c9d98621d5e4d`. One genesis validator; chain relay and store node deployed; messaging verified end to end on 2026-09-12. |
| `hashgram-node` (Rust): libp2p swarm with the genesis-checking handshake, mailboxes, blobs, social log, safety table, rewards agent | Runs. 63 network-level acceptance checks pass (`scripts/testnet/phase2.sh`). |
| `hashgram-sdk` + `hashgram-client` (Rust): vault, wallet, identity, MLS messaging, social, media, calls | Runs against a live devnet and Mainnet: identities registered, E2EE messages delivered, reels published, private media round-tripped. |
| `hashgram-indexer`, `hashgram-safety` (Go) | Run. Feeds served from PostgreSQL; a scam post blocked end to end. |
| Fuzzing, `cargo audit`, hardened systemd units, installer for the node stack | Complete. |
| Windows desktop app (`apps/desktop`, Tauri 2 + SolidJS, v0.1.1) | Exists (97 commands: wallet, messenger, social, calls, identity, node). Being superseded by the Hashgram One desktop (`docs/DESKTOP_APP_MASTER_PROMPT.md`). |
| iOS, Android apps | Not built. Specifications and the SDK exist. |
| Token bridge | Not built; interfaces sketched only. |
| **Hashgram One** (`node/hashgram-app`, `sdk/rust/hashgram-sdk`, `hashgram-client one …`) | |
| HashMail | **Implemented.** `MailMessage` model with bounds, threading, BCC copies, inline/blob/Drive attachments, DELIVERED/READ receipts, local folders and flags with device sync, spam/Requests policy, authenticated-sender rule. E2E: `scripts/testnet/hashgram-one-e2e.sh`. |
| HashDrive | **Implemented.** Segmented XChaCha20-Poly1305 objects, encrypted `DriveManifest` with folders/versions/trash/tombstones, deterministic multi-device merge, `DriveKeyring` device sync, snapshot/live capabilities, revocation, folder shares. Partial: no provider-enforced deletion, separate Drives on two devices are not auto-merged, `PendingUpload` bookkeeping is not yet written by `upload`. |
| People | **Implemented.** Resolution of `hash1…`/`@name`/`name@hashgram.io`, contact requests and responses over MLS, friend/pending/blocked/muted/trusted states, `ContactsSnapshot` device sync, private `ProfileCard` with optional wallet disclosure, public follow mirror. |
| Feed / Circles | **Implemented.** Typed feed over the social log (`friends`, `following`, `author`, `thread`, post/comment/react/repost) with cursors; Circles as MLS groups with `CircleEvent` posts, comments, one-reaction-per-author, polls with closing, author-only delete. Partial: `history_visible_to_new_members` is carried but not acted on; circles have no roles. |
| Spaces | **Implemented.** Signed hash-chained `SpaceEvent` log under the `hashgram-app/v1/<network>/space-event` domain, role state machine enforced by every reader, per-actor sequences, pending-event retry, MLS roster reconciliation on invite/remove, space drive, space mail. |
| Earn API | **Implemented** (SDK `provider`): status, lifecycle derivation, earnings, register/update/unbond/withdraw over `x/serviceproof`. Economics unchanged; storage assignment on Mainnet is inert until governance registers an assigner. |
| Indexer leaderboards | **Implemented** (Go, additive): `balances` projection, `/v1/leaderboards/{holders,validators,providers,earners}`, `/v1/validators`, `/v1/network/stats`. |
| Mail gateway (`services/mail-gateway`) | **Partial.** Library complete: SMTP server state machine and client, MIME parse/render, DKIM (rsa/ed25519), address mapping, policy, rate limits, SQLite queue, `Bridge::run` over `HashgramOne`. The `hashgram-mail-gateway` binary entry point is a placeholder; `docs/MAIL_GATEWAY.md` is not yet written. Native HashMail does not depend on it. |

## The chain

Eight modules on top of the standard Cosmos SDK set.

| Module | What it does |
| --- | --- |
| [`x/network`](x/network) | Network identity, genesis hash pinning, signature domain separation |
| [`x/founder`](x/founder) | The Founder revenue ledger and its compile-time fee ceiling |
| [`x/feerouter`](x/feerouter) | Splits protocol fee revenue; never touches transferred principal |
| [`x/welcome`](x/welcome) | Tiered joining reward, 50/5/1/0 HASH, capped at 1,850,000 HASH |
| [`x/serviceproof`](x/serviceproof) | Proof of Useful Service: receipts, storage challenges, bonds, fraud scoring |
| [`x/username`](x/username) | `@name` registry with confusable-character defence |
| [`x/identity`](x/identity) | Root identities, device certificates, social recovery. Public keys only. |
| [`x/treasury`](x/treasury) | Named genesis allocations, spendable only by governance |

Standard modules: `auth`, `bank`, `staking`, `slashing`, `distribution`,
`gov`, `evidence`, `vesting`, `upgrade`, `consensus`, `genutil`, `feegrant`,
`authz`. `x/mint` and `x/circuit` are deliberately excluded.

## Tokenomics

1,000,000,000 HASH, fixed forever. 1 HASH = 1,000,000 uhash.

| Allocation | HASH | Share |
| --- | --- | --- |
| Founder | 200,000,000 | 20% |
| Community / useful-service reserve | 500,000,000 | 50% |
| Treasury | 150,000,000 | 15% |
| Growth (includes the 1,850,000 welcome pool) | 50,000,000 | 5% |
| Developer grants | 50,000,000 | 5% |
| Liquidity | 50,000,000 | 5% |

The Founder allocation is 20,000,000 spendable at genesis and 180,000,000 in a
`PeriodicVestingAccount` released monthly over eight years.

Full detail, and the reasoning behind each number, in
[docs/TOKENOMICS.md](docs/TOKENOMICS.md).

## Build and run

Requires Go 1.26.8 and a Linux host. Ubuntu Server 24.04 LTS is what the
tooling targets and what it has been tested on.

```bash
make build          # binaries into build/
make test           # go test -race
make ci             # the whole pipeline: lint, gosec, gitleaks, govulncheck, tests
```

Bring up a single-node devnet and run the acceptance checks against it:

```bash
scripts/testnet/devnet.sh
```

That script builds a genesis with the real tooling, starts a chain, and then
verifies the claims made above against it: that a 100 HASH transfer delivers
100 HASH, that the Founder accrues exactly 1% of collected fees, that total
supply is exactly 1e15 uhash and does not move, that there is no mint module,
that a visually confusable username is refused, and that
`hashgramctl mainnet-preflight` refuses to pass on a devnet host.

Four validators, a killed validator, and fork isolation:

```bash
scripts/testnet/four-validator.sh
```

Hashgram One end to end on a local devnet (mock chain gateway, one
store/relay/media node, two `hashgram-client one …` identities exercising
Mail, Drive, People, Spaces, Circles and device reconciliation; every step
asserts on output):

```bash
cd node && cargo build -p hashgram-node -p hashgram-client -p hashgram-devtools
scripts/testnet/hashgram-one-e2e.sh
```

## Binaries

| Binary | Purpose |
| --- | --- |
| `hashgramd` | The node. Cosmos SDK application and CometBFT. |
| `hashgramctl` | Operator CLI: install, join, roles, status, backup, preflight. |
| `hashgram-test-client` | Developer client that exercises the protocol from outside a node. |
| `hashgram-keygen` | Offline key generation. No networking, no disk writes. |
| `hashgram-node` (Rust) | Store / relay / media / bootstrap node on the libp2p swarm. |
| `hashgram-client` (Rust) | Reference CLI over `hashgram-sdk`; `hashgram-client one mail|drive|people|feed|circle|space|devices|provider|network|sync` is the Hashgram One developer harness. |
| `hashgram-mail-gateway` (Rust) | External SMTP bridge (`services/mail-gateway`). Library implemented; binary entry point still a placeholder. |

## Repository layout (application layer)

| Path | Purpose |
| --- | --- |
| `proto/hashgram/app/v1/app.proto` | `AppMessage` envelope and the HashMail, HashDrive, People, Circles, Spaces and DeviceSync bodies; carried only inside MLS. |
| `node/hashgram-app` | Pure application protocol, no I/O: versioning, mail model and threading, spam policy, Drive segment crypto / manifest / merge / capabilities, Space signed log and role state machine, Circle timeline, contacts. |
| `sdk/rust/hashgram-sdk` | The application boundary: `HashgramOne` facade with `mail`, `drive`, `people`, `feed`, `circles`, `spaces`, `devices`, `sync`, `provider`, `network`, `wallet`, `store` (sealed local redb), plus the pre-existing `account`, `link`, `messaging`, `blob`, `social`, `chain_relay`. |
| `node/hashgram-client/src/one.rs` | `hashgram-client one …` commands over the same facade the desktop uses. |
| `services/mail-gateway` | SMTP ↔ HashMail bridge owning an ordinary Hashgram identity. |
| `indexer/api_network.go` | Balances projection, leaderboards, validators, network stats. |
| `apps/desktop` | Windows desktop app v0.1.1 (Tauri 2 + SolidJS); superseded by the Hashgram One desktop. |
| `scripts/testnet/hashgram-one-e2e.sh` | Hashgram One acceptance suite on a local devnet. |

## Documentation

Written from the code, not from intent. Where something is not implemented,
the document says so rather than describing it in the present tense.

**Start here**
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit together
- [TOKENOMICS.md](docs/TOKENOMICS.md) — supply, allocations, emission, the Founder share
- [OPERATIONS.md](docs/OPERATIONS.md) — running a node day to day

**Hashgram One**
- [HASHGRAM_ONE_ARCHITECTURE.md](docs/HASHGRAM_ONE_ARCHITECTURE.md) — layering, where state lives, the application envelope
- [HASHGRAM_ONE_AUDIT.md](docs/HASHGRAM_ONE_AUDIT.md) — the pre-transformation baseline and findings
- [HASHMAIL.md](docs/HASHMAIL.md) — addresses, `MailMessage`, transport, threading, receipts, spam policy
- [HASHDRIVE.md](docs/HASHDRIVE.md) — object encryption, manifest, merge, sharing and revocation
- [SPACES.md](docs/SPACES.md) — Spaces (signed role log) and Circles (flat MLS groups)
- [SYNC_ENGINE.md](docs/SYNC_ENGINE.md) — the sync state machine, idempotency, resumability, what a desktop app should do
- [PRIVACY_MODEL.md](docs/PRIVACY_MODEL.md) — who can see what, actor by actor
- [MULTI_DEVICE_SECURITY.md](docs/MULTI_DEVICE_SECURITY.md) — devices in MLS groups, revocation, recovery
- [ADR_HASH_STORAGE_MARKET.md](docs/ADR_HASH_STORAGE_MARKET.md) — paid storage decision record

**Running a node**
- [NODE_ROLES.md](docs/NODE_ROLES.md) — the eight roles and what each needs
- [MAINNET.md](docs/MAINNET.md) — genesis procedure and joining an existing network
- [DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md) — backups, restores, key loss, compromise

**Security**
- [SECURITY.md](docs/SECURITY.md) — key handling, hardening, what is protected and how
- [THREAT_MODEL.md](docs/THREAT_MODEL.md) — what an attacker can and cannot do
- [DECENTRALIZATION.md](docs/DECENTRALIZATION.md) — an honest account of where control sits
- [LOGGING_POLICY.md](docs/LOGGING_POLICY.md) — what a node may and may not log

**Launch**
- [FOUNDER_LAUNCH_RUNBOOK.md](docs/FOUNDER_LAUNCH_RUNBOOK.md) — the full launch sequence
- [LAUNCH_HANDOVER_KA.md](docs/LAUNCH_HANDOVER_KA.md) — the same launch as exact commands for the Genesis VPS, in Georgian

**Building a client**
- [CLIENT_CONNECTIVITY_SPEC.md](docs/CLIENT_CONNECTIVITY_SPEC.md) — every interface a client may rely on, and what does not exist
- [PROTOCOL.md](docs/PROTOCOL.md) — the off-chain wire protocol: identity, canonical signing, handshake, RPC, gossip, discovery
- [MESSAGING.md](docs/MESSAGING.md) — MLS groups over store-and-forward mailboxes
- [SOCIAL_PROTOCOL.md](docs/SOCIAL_PROTOCOL.md) — the twelve signed event families and their acceptance rules
- [STORAGE.md](docs/STORAGE.md) — content addressing, private encryption, replication and repair
- [CALLS.md](docs/CALLS.md) — TURN credentials, SFU, E2EE signalling
- [MODERATION.md](docs/MODERATION.md) — the Safety Engine and signed attestations over public content only
- [SERVICE_REWARDS.md](docs/SERVICE_REWARDS.md) — how evidence is produced off chain and settled on chain
- [PROMPT_WINDOWS_DESKTOP.md](docs/PROMPT_WINDOWS_DESKTOP.md) — a Windows build specification
- [PROMPT_IOS_APP.md](docs/PROMPT_IOS_APP.md) — what differs on iOS
- [PROMPT_ANDROID_APP.md](docs/PROMPT_ANDROID_APP.md) — what differs on Android

**Status**
- [FINAL_REPORT.md](docs/FINAL_REPORT.md) — the build report, operator procedures, and what is not done
- [PHASE1_REPORT.md](docs/PHASE1_REPORT.md) — verbatim output of every test run

## License

Apache License 2.0. See [LICENSE](LICENSE).
