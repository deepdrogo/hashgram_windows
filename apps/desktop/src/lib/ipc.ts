// Typed wrappers over the Rust commands. Every type here mirrors a Rust
// struct in src-tauri/src/commands.rs; keep them in step.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type NetworkKind = "mainnet" | "devnet";

export interface AppStatus {
  vault_exists: boolean;
  unlocked: boolean;
  address: string | null;
  network: NetworkKind;
  chain_id: string;
  onboarding_done: boolean;
  hello_available: boolean;
  hello_enabled: boolean;
  version: string;
  commit: string;
  data_dir: string;
  updater_configured: boolean;
  uptime_ms: number;
}

export interface AccountInfo {
  address: string;
  device_id: string;
  has_wallet_key: boolean;
  has_root_key: boolean;
}

export interface Settings {
  network: {
    kind: NetworkKind;
    devnet_genesis_hash: string;
    devnet_bootstrap: string[];
    https_endpoints: string[];
    local_node_api: string;
  };
  security: { auto_lock_minutes: number; hello_enabled: boolean; clipboard_clear_secs: number };
  appearance: { reduced_motion: boolean; compact: boolean };
  notifications: { messages: boolean; calls: boolean };
  media: { autoplay: boolean; cache_mb: number };
  updates: { auto_check: boolean; channel: string };
  advanced: { log_level: string };
  start_with_windows: boolean;
  onboarding_done: boolean;
  device_label: string;
}

export interface Verification {
  peers: string[];
  operators: string[];
  heights: number[];
  agreed: boolean;
  single_operator: boolean;
  disputed: string[];
}

export type Source =
  | { kind: "local_node"; url: string }
  | { kind: "p2p_relay" }
  | { kind: "https"; url: string };

export interface ChainRead {
  value: unknown;
  verification: Verification | null;
  source: Source;
  height: number;
  cached: boolean;
}

export interface EndpointHealth {
  source: Source;
  ok: boolean;
  detail: string;
  active: boolean;
  latency_ms: number;
}

export interface ChainHealth {
  sources: EndpointHealth[];
  active: Source | null;
  relay_operators: number;
}

export interface PeerView {
  peer_id: string;
  operator: string;
  roles: string[];
  latency_ms: number | null;
  transport: string;
  direction: string;
  connected_secs: number;
  discovery: string;
  served_last_read: boolean;
  agreed: boolean | null;
  verified: boolean;
  relays_chain: boolean;
}

export interface RejectedView {
  peer_id: string;
  reason: string;
  label: string;
  at: number;
}

export interface NetSnapshot {
  running: boolean;
  network: string;
  chain_id: string;
  genesis_hash: string;
  own_peer_id: string;
  peers: PeerView[];
  rejected: RejectedView[];
  nat: string;
  peerstore_size: number;
  builtin_seeds: string[];
  kad_peers: number;
  verified: number;
  last_read: Verification | null;
  uptime_secs: number;
  listen_addrs: string[];
  external_addrs: string[];
}

export interface WalletOverview {
  address: string;
  balance_uhash: string;
  account_exists: boolean;
  account_number: number | null;
  sequence: number | null;
  vesting_type: string | null;
  original_vesting_uhash: string | null;
  vesting_end: number | null;
  vesting_start: number | null;
  username: string | null;
  verification: Verification | null;
  source: Source;
  height: number;
}

export type MsgSpec =
  | { type: "send"; to: string; amount_uhash: string }
  | { type: "delegate"; validator: string; amount_uhash: string }
  | { type: "undelegate"; validator: string; amount_uhash: string }
  | { type: "redelegate"; from_validator: string; to_validator: string; amount_uhash: string }
  | { type: "withdraw_rewards"; validator: string }
  | { type: "vote"; proposal_id: number; option: string }
  | { type: "register_username"; name: string }
  | { type: "renew_username"; name: string }
  | { type: "transfer_username"; name: string; to: string }
  | { type: "release_username"; name: string }
  | { type: "set_recovery_config"; guardians: string[]; threshold: number; delay_blocks: number }
  | { type: "cancel_recovery" }
  | { type: "revoke_device"; device_id: string }
  | { type: "begin_unbonding" }
  | { type: "withdraw_bond" };

export interface TxPreview {
  summary: string;
  warnings: string[];
  gas_limit: number;
  fee_uhash: string;
  simulated: boolean;
  founder_share_uhash: string;
  source: Source;
}

export interface TxSubmitted {
  hash: string;
  summary: string;
}

export interface PendingRow {
  hash: string;
  submitted: number;
  summary: string;
  state: "pending" | "committed" | "failed";
  height: number;
  raw_log: string;
}

export interface DeviceInfo {
  device_id: string;
  label: string;
  platform: string;
  revoked: boolean;
  pubkey_hex: string;
  is_this_device: boolean;
}

export interface IdentityStatus {
  registered: boolean;
  devices: DeviceInfo[];
  this_device_id: string;
  this_device_pubkey: string;
  this_device_registered: boolean;
  rotation_count: number | null;
  recovery: unknown;
}

export type SearchResult =
  | { kind: "address"; address: string; username: string | null }
  | { kind: "username"; name: string; address: string; expiry_height: number | null }
  | { kind: "username_available"; name: string; confusable_with: string[] }
  | { kind: "tx"; hash: string; height: number | null; found: boolean }
  | { kind: "hashtag"; tag: string }
  | { kind: "channel"; id: string }
  | { kind: "nothing"; reason: string };

export interface HelpPage {
  slug: string;
  title: string;
  docs_path: string;
}

export interface SpanRecord {
  name: string;
  micros: number;
  at_ms: number;
  origin: "rust" | "ui";
}

const call = <T,>(cmd: string, args?: Record<string, unknown>) => invoke<T>(cmd, args);

export const ipc = {
  appStatus: () => call<AppStatus>("app_status"),
  onboardingGenerate: () => call<string[]>("onboarding_generate"),
  onboardingCheckWords: (positions: number[], words: string[]) =>
    call<boolean>("onboarding_check_words", { positions, words }),
  onboardingCreate: (passphrase: string, deviceLabel: string) =>
    call<AccountInfo>("onboarding_create", { passphrase, deviceLabel }),
  onboardingRestorePreview: (mnemonic: string) =>
    call<{ address: string }>("onboarding_restore_preview", { mnemonic }),
  onboardingRestore: (mnemonic: string, passphrase: string, deviceLabel: string) =>
    call<AccountInfo>("onboarding_restore", { mnemonic, passphrase, deviceLabel }),
  unlock: (passphrase: string) => call<AccountInfo>("unlock", { passphrase }),
  lock: () => call<void>("lock"),
  touch: () => call<void>("touch"),
  changePassphrase: (current: string, next: string) =>
    call<void>("change_passphrase", { current, new: next }),
  helloEnable: (passphrase: string) => call<void>("hello_enable", { passphrase }),
  helloUnlock: () => call<AccountInfo>("hello_unlock"),
  helloDisable: () => call<void>("hello_disable"),
  wipeLocalData: (confirm: string) => call<void>("wipe_local_data", { confirm }),
  settingsGet: () => call<Settings>("settings_get"),
  settingsSet: (settings: Settings) => call<void>("settings_set", { settings }),
  netSnapshot: () => call<NetSnapshot>("net_snapshot"),
  netMeasureLatency: () => call<void>("net_measure_latency"),
  netForgetPeers: () => call<void>("net_forget_peers"),
  netReconnect: () => call<void>("net_reconnect"),
  chainHealth: (probe: boolean) => call<ChainHealth>("chain_health", { probe }),
  diagnosticsExport: () => call<string>("diagnostics_export"),
  chainGet: (path: string) => call<ChainRead>("chain_get", { path }),
  chainGetMany: (paths: string[]) =>
    call<Array<{ Ok: ChainRead } | { Err: string }>>("chain_get_many", { paths }),
  walletOverview: () => call<WalletOverview>("wallet_overview"),
  txPreview: (spec: MsgSpec) => call<TxPreview>("tx_preview", { spec }),
  txSubmit: (spec: MsgSpec, memo = "") => call<TxSubmitted>("tx_submit", { spec, memo }),
  txRecent: () => call<PendingRow[]>("tx_recent"),
  txStatus: (hash: string) => call<unknown>("tx_status", { hash }),
  txHasPending: () => call<boolean>("tx_has_pending"),
  identityStatus: () => call<IdentityStatus>("identity_status"),
  identityRegister: (label: string) => call<TxSubmitted>("identity_register", { label }),
  searchResolve: (query: string) => call<SearchResult>("search_resolve", { query }),
  searchRecent: () => call<string[]>("search_recent"),
  qrSvg: (text: string) => call<string>("qr_svg", { text }),
  helpList: () => call<HelpPage[]>("help_list"),
  helpPage: (slug: string) => call<string>("help_page", { slug }),
  perfSnapshot: () => call<SpanRecord[]>("perf_snapshot"),
  perfMark: (name: string, micros: number) => call<void>("perf_mark", { name, micros }),
  perfMemory: () => call<number>("perf_memory"),
  openDataDir: () => call<void>("open_data_dir"),
  saveTextFile: (path: string, contents: string) => call<void>("save_text_file", { path, contents }),
};

export type Events = {
  "net:changed": void;
  "session:locked": void;
  "settings:changed": void;
  "tx:update": { hash: string; state: string; height?: number; raw_log?: string };
  "deep-link": { url: string };
};

export function on<K extends keyof Events>(
  name: K,
  handler: (payload: Events[K]) => void,
): Promise<UnlistenFn> {
  return listen<Events[K]>(name, (e) => handler(e.payload));
}

/** Reads a JSON path like "balance.amount" out of an unknown value. */
export function pick(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const key of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;

export const num = (v: unknown, fallback = 0): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
};

export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Amount of `denom` in a gateway value that may be a coin list
 * (`[{denom, amount}]`), a single coin, or a bare string. "0" when absent.
 */
export function coin(v: unknown, denom = "uhash"): string {
  if (Array.isArray(v)) {
    const c = v.find((x) => str(pick(x, "denom")) === denom);
    return c ? str(pick(c, "amount"), "0") : "0";
  }
  if (v && typeof v === "object") return str(pick(v, "amount"), "0");
  if (typeof v === "string") return v || "0";
  return "0";
}
