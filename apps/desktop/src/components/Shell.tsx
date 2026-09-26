// The application frame: left rail (Pulse · Reels · Local · Chats · Mail ·
// Drive · Spaces · Contacts, then Wallet · Earn · Network, then My profile ·
// Settings), top bar with search, theme and sync state, toasts.
// Keyboard: Ctrl+K search, Ctrl+L lock, Alt+1..9 sections.
import { For, Show, createEffect, createMemo, createSignal, onMount, onCleanup, type ParentProps } from "solid-js";
import { A, useLocation, useNavigate } from "@solidjs/router";
import { Mail, HardDrive, Users, LayoutGrid, Coins, Wallet, Network, Settings, CircleHelp, Search, Lock, Download, X, ShieldAlert, LogOut, UserCircle, Activity, MessageSquare, Sun, Moon, Film, MapPin } from "lucide-solid";
import { store } from "~/lib/store";
import { updates } from "~/lib/updates";
import { ipc } from "~/lib/ipc";
import { t, type Key } from "~/lib/i18n";
import { setNavigator } from "~/lib/nav";
import { CommandPalette } from "./CommandPalette";
import { PerfPanel } from "./PerfPanel";
import { SyncIndicator } from "./SyncIndicator";
import { Kbd, Button } from "./ui";
import { confirm } from "~/lib/dialogs";

type NavGroup = "social" | "assets" | "you";

export interface NavItem {
  to: string;
  key: Key;
  icon: typeof Mail;
  accel: string;
  group: NavGroup;
  /** Path prefix that marks the item active; defaults to `to`. */
  match?: string;
  /** False while a section is still being built: it keeps its place in the
   *  order but is not shown, so no rail entry leads to an empty screen. */
  enabled?: boolean;
}

export const NAV: NavItem[] = [
  { to: "/pulse", key: "nav_pulse", icon: Activity, accel: "1", group: "social" },
  // Reels and Local were tabs inside Pulse. Both are destinations people go
  // to on purpose rather than filters of the timeline, and a tab strip
  // hides them behind whichever tab was open last.
  { to: "/reels", key: "nav_reels", icon: Film, accel: "2", group: "social" },
  { to: "/local", key: "nav_local", icon: MapPin, accel: "3", group: "social" },
  { to: "/chats", key: "nav_chats", icon: MessageSquare, accel: "4", group: "social" },
  { to: "/mail", key: "nav_mail", icon: Mail, accel: "5", group: "social" },
  { to: "/drive", key: "nav_drive", icon: HardDrive, accel: "6", group: "social" },
  { to: "/spaces", key: "nav_spaces", icon: LayoutGrid, accel: "", group: "social" },
  { to: "/contacts", key: "nav_contacts", icon: Users, accel: "", group: "social" },
  { to: "/wallet", key: "nav_wallet", icon: Wallet, accel: "7", group: "assets" },
  { to: "/earn", key: "nav_earn", icon: Coins, accel: "8", group: "assets" },
  { to: "/network", key: "nav_network", icon: Network, accel: "9", group: "assets" },
  // `/profile/me` only: matching all of `/profile` lit this entry up while
  // reading somebody else's profile, which read as "you were taken to your
  // own page".
  { to: "/profile/me", key: "nav_profile", icon: UserCircle, accel: "0", group: "you", match: "/profile/me" },
  { to: "/settings", key: "nav_settings", icon: Settings, accel: "", group: "you" },
];

const GROUPS: NavGroup[] = ["social", "assets", "you"];

/** The rail in the order the user sees it, without the sections still in build. */
export const visibleNav = () => NAV.filter((n) => n.enabled !== false);

export function Shell(props: ParentProps) {
  const [palette, setPalette] = createSignal(false);
  const [perf, setPerf] = createSignal(false);
  const navigate = useNavigate();
  const location = useLocation();
  const signOut = async () => {
    const ok = await confirm(
      "Sign out and remove this account from this PC?\n\nThis deletes the local vault, mail and files. Make sure you have the 24 words or an encrypted backup. This cannot be undone.",
    );
    if (!ok) return;
    await ipc.lock();
    await ipc.wipeLocalData("DELETE");
    // The vault this window was built around no longer exists, so the window
    // starts over at onboarding. This is the one reload the app performs.
    window.location.reload();
  };

  setNavigator((to) => navigate(to));

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPerf((v) => !v);
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        void ipc.lock();
      } else if (e.altKey && /^[0-9]$/.test(e.key)) {
        const item = visibleNav().find((n) => n.accel && n.accel === e.key);
        if (item) {
          e.preventDefault();
          navigate(item.to);
        }
      } else if (e.key === "F1") {
        e.preventDefault();
        navigate("/help");
      }
    };
    window.addEventListener("keydown", onKey);
    let last = 0;
    const activity = () => {
      const now = Date.now();
      if (now - last > 15_000) {
        last = now;
        void ipc.touch().catch(() => undefined);
      }
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    });
  });

  createEffect(() => {
    if (!store.locked() && store.settings() && store.status()) void updates.checkOnStart();
  });
  const updateBanner = () => {
    const p = updates.phase();
    return (p === "available" && !updates.dismissed()) || p === "downloading" || p === "installing";
  };

  const isActive = (to: string) => {
    const path = location.pathname;
    // Viewing your own profile by address is still your own profile.
    if (to === "/profile/me") {
      const me = store.status()?.address;
      return path === "/profile/me" || (!!me && path === `/profile/${me}`);
    }
    return path.startsWith(to);
  };
  const badge = (to: string): number => {
    if (to === "/mail") return (store.counts()["inbox"]?.unread ?? 0) + (store.counts()["requests"]?.total ?? 0);
    if (to === "/contacts") return store.requestsIn();
    if (to === "/chats") return store.chatsUnread();
    if (to === "/wallet") return store.pendingTx();
    return 0;
  };
  const light = createMemo(() => store.resolvedTheme() === "light");

  return (
    <div class="flex h-full flex-col">
      <Show when={store.status()?.network === "devnet"}>
        <div class="flex h-6 shrink-0 items-center justify-center border-b border-fg bg-fg text-[11px] font-semibold tracking-wide text-bg" role="status">
          {t("devnet_banner")}
        </div>
      </Show>
      <Show when={updateBanner()}>
        <div class="flex h-8 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 text-xs" role="status">
          <Download size={14} aria-hidden="true" />
          <span class="flex-1">
            <Show when={updates.phase() === "available"}>Hashgram One {updates.available()?.version} is available.</Show>
            <Show when={updates.phase() === "downloading"}>Downloading Hashgram One {updates.available()?.version}…</Show>
            <Show when={updates.phase() === "installing"}>Signature verified — installing and restarting…</Show>
          </span>
          <Show when={updates.phase() === "available"}>
            <Button variant="brand" size="sm" onClick={() => void updates.install()}>
              Install and restart
            </Button>
            <A href="/settings/updates" class="text-muted hover:text-fg">
              Details
            </A>
            <button type="button" class="text-muted hover:text-fg" aria-label="Dismiss" onClick={() => updates.setDismissed(true)}>
              <X size={14} />
            </button>
          </Show>
        </div>
      </Show>
      <div class="flex min-h-0 flex-1">
        <nav class="flex w-[196px] shrink-0 flex-col border-r border-border bg-surface" aria-label="Main">
          <div class="flex h-11 items-center gap-2 px-3.5">
            <Logo size={16} />
            <span class="text-[13px] font-semibold tracking-tight">{t("app_name")}</span>
          </div>
          <div class="flex-1 overflow-y-auto px-2 pt-1">
            <For each={GROUPS}>
              {(group, i) => (
                <ul class={`space-y-px ${i() > 0 ? "mt-3 border-t border-border pt-3" : ""}`}>
                  <For each={visibleNav().filter((n) => n.group === group)}>
                    {(item) => {
                      const active = () => isActive(item.match ?? item.to);
                      return (
                        <li>
                          <A
                            href={item.to}
                            class={`row flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] ${active() ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"}`}
                            aria-current={active() ? "page" : undefined}
                            title={item.accel ? `${t(item.key)} (Alt+${item.accel})` : t(item.key)}
                            data-nav={item.key}
                          >
                            <item.icon size={15} aria-hidden="true" class={active() ? "text-brand" : ""} />
                            <span class="flex-1">{t(item.key)}</span>
                            <Show when={badge(item.to) > 0}>
                              <span class="badge-strong tnum" title={String(badge(item.to))}>
                                {badge(item.to) > 99 ? "99+" : badge(item.to)}
                              </span>
                            </Show>
                          </A>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              )}
            </For>
          </div>
          <div class="space-y-px px-2 pb-2">
            <A href="/help" class={`row flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] ${isActive("/help") ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"}`}>
              <CircleHelp size={15} aria-hidden="true" />
              <span class="flex-1">{t("nav_help")}</span>
              <Kbd>F1</Kbd>
            </A>
            <button type="button" class="row flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted hover:text-fg" onClick={() => void ipc.lock()}>
              <Lock size={15} aria-hidden="true" />
              <span class="flex-1 text-left">{t("lock")}</span>
              <Kbd>Ctrl L</Kbd>
            </button>
            <button type="button" class="row flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted hover:text-fg" onClick={() => void signOut()}>
              <LogOut size={15} aria-hidden="true" />
              <span class="flex-1 text-left">{t("sign_out")}</span>
            </button>
          </div>
        </nav>
        <div class="flex min-w-0 flex-1 flex-col">
          <header class="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
            <button
              type="button"
              class="flex h-7 w-full max-w-xl items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-xs text-muted hover:text-fg"
              onClick={() => setPalette(true)}
            >
              <Search size={13} />
              <span class="flex-1 truncate text-left">{t("search_placeholder")}</span>
              <Kbd>Ctrl K</Kbd>
            </button>
            <span class="flex-1" />
            <SyncIndicator />
            <button
              type="button"
              class="btn-ghost btn-icon-sm"
              title={light() ? t("theme_switch_to_dark") : t("theme_switch_to_light")}
              aria-label={light() ? t("theme_switch_to_dark") : t("theme_switch_to_light")}
              onClick={() => void store.setTheme(light() ? "dark" : "light")}
            >
              {light() ? <Moon size={14} /> : <Sun size={14} />}
            </button>
            <button type="button" class="btn-ghost btn-icon-sm" title={`${t("lock")} (Ctrl+L)`} aria-label={t("lock")} onClick={() => void ipc.lock()}>
              <Lock size={14} />
            </button>
          </header>
          <Show when={store.identity() && !store.identity()!.this_device_registered}>
            <div class="flex min-h-10 shrink-0 items-center gap-3 border-b border-border bg-surface-2 px-3 text-xs" role="alert">
              <ShieldAlert size={15} class="text-brand" aria-hidden="true" />
              <span class="flex-1">
                This PC is not registered for your identity. Posting and mail need at least 0.01 HASH for the one-time registration; a username additionally costs 1 HASH.
              </span>
              <Button size="sm" variant="brand" onClick={() => navigate("/wallet/devices")}>
                Finish setup
              </Button>
            </div>
          </Show>
          <main class="min-h-0 min-w-0 flex-1 overflow-hidden" id="main">
            {props.children}
          </main>
        </div>
      </div>
      <CommandPalette open={palette()} onClose={() => setPalette(false)} />
      <PerfPanel open={perf()} onClose={() => setPerf(false)} />
      <Toasts />
    </div>
  );
}

export function Logo(props: { size?: number }) {
  const s = () => props.size ?? 18;
  return (
    <svg viewBox="0 0 64 64" width={s()} height={s()} aria-hidden="true" class="text-fg">
      <rect x="21" y="12" width="6" height="40" fill="currentColor" />
      <rect x="37" y="12" width="6" height="40" fill="currentColor" />
      <rect x="12" y="21" width="40" height="6" fill="currentColor" />
      <rect x="12" y="37" width="40" height="6" fill="currentColor" />
    </svg>
  );
}

function Toasts() {
  return (
    <div class="pointer-events-none fixed bottom-3 right-3 z-50 flex flex-col gap-2" aria-live="polite">
      <For each={store.toasts()}>
        {(tst) => (
          <div class={`pointer-events-auto card flex items-center gap-3 px-3 py-2 text-xs fade-in ${tst.kind === "error" ? "border-fg" : ""}`} role="status">
            <span class="max-w-sm selectable">{tst.text}</span>
            <Show when={tst.action}>
              <button
                type="button"
                class="font-medium text-brand hover:underline"
                onClick={() => {
                  tst.action?.run();
                  store.dismissToast(tst.id);
                }}
              >
                {tst.action?.label}
              </button>
            </Show>
            <button type="button" class="text-muted hover:text-fg" aria-label="Dismiss" onClick={() => store.dismissToast(tst.id)}>
              <X size={12} />
            </button>
          </div>
        )}
      </For>
    </div>
  );
}
