# Hashgram for Windows

Wallet, messenger, social network, calls, identity and node in one
application, talking to the Hashgram peer-to-peer network — never to one
server. Built to `docs/PROMPT_DESKTOP_AI.md`.

## Stack

- **Tauri 2** (Rust core, WebView2 UI), **SolidJS + Vite + Tailwind v4** front end.
- The in-repo **`hashgram-sdk`** does everything cryptographic and network:
  vault, MLS messaging, signed social events, blobs, calls, the P2P chain
  relay with two-operator cross-checking.
- **rusqlite** (WAL) with XChaCha20-Poly1305 column sealing under a key
  kept in the vault; **DPAPI + Windows Hello** for day-to-day unlock.
- Strict monochrome design: exactly seven colours (`src/styles/tokens.css`),
  Lucide icons, shadcn-style primitives, virtualised lists.

## Layout

```
apps/desktop/
  src/                 SolidJS app (routes/, components/, lib/)
  src-tauri/           Rust core: commands, vault, net, chain access, chat, social, node manager
  service/             hashgram-node-service.exe: supervising Windows service / task wrapper
  help/                In-app Help pages (Markdown, bundled)
  tests/               vitest: palette, PersonLabel, rules (no server, no mining, 24 words), format
  release.ps1          Reproducible release: tests, sidecars, NSIS/MSI, SHA-256
```

## Develop

```powershell
pnpm install                      # pnpm 12 (hoisted linker; see pnpm-workspace.yaml)
cd ..\..\node; cargo build -p hashgram-node -p hashgram-node-service; cd ..\apps\desktop
pnpm tauri dev                    # HASHGRAM_DESKTOP_HOME=<dir> for a throwaway profile
pnpm test                         # vitest
cd ..\..\node; cargo test -p hashgram-desktop
```

Ctrl+K search · Ctrl+L lock · Ctrl+Shift+P performance panel · F1 help.

## Release

```powershell
pwsh .\release.ps1                # artefacts + SHA256SUMS.txt in dist/desktop
```

Environment for signing (owner's machine only): `TAURI_SIGNING_PRIVATE_KEY`
(minisign, updater manifests), `HASHGRAM_CODESIGN_THUMBPRINT` (Authenticode).
The public updater key lives in `src-tauri/tauri.conf.json`.

## Rules enforced by tests

- Accounts are 24 words only; login is restore; no server registration.
- A display name is never shown without the verified `@username` or address.
- Only the seven palette colours anywhere in the UI chrome.
- No hardcoded server address anywhere under `apps/`; no IP literal but loopback.
- The m-word for proof-of-work never appears as a feature; the section is **Earn**.
- Nothing plaintext (keys, mnemonic, messages) in any file the app writes.
- The Mainnet genesis hash is compiled in; a peer on another genesis is
  listed as "wrong network" and never retried silently.

## Data

`%LOCALAPPDATA%\Hashgram`: `vault.json` (encrypted), `hashgram.db`
(sealed columns), `peers.json`, `settings.json`, `media-cache\`,
`node\` (when a node is run from this PC). Uninstall keeps it by default.
