// A small emoji picker.
//
// A fixed, bundled set rather than a font-and-data package: the list is a
// few hundred characters of source, it needs no network and no licence
// notice, and it renders with whatever emoji font Windows already has.
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Smile } from "lucide-solid";

const GROUPS: { name: string; emoji: string[] }[] = [
  {
    name: "Smileys",
    emoji: [..."😀😃😄😁😆😅😂🙂🙃😉😊😇🥰😍🤩😘😋😛🤪🤗🤔🤨😐😑😴😌😔😕🙁😢😭😤😠🤯😳🥵🥶😱😨😰😥🤝"],
  },
  { name: "People", emoji: [..."👋🤚🖐️✋👌🤌🤏✌️🤞🫰🤟🤘👈👉👆👇☝️👍👎✊👊🙌👏🙏💪🦾👀🧠👶🧒👦👧🧑👨👩🧓"] },
  { name: "Nature", emoji: [..."🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🙈🙉🙊🐔🐧🐦🦆🦉🦄🐝🦋🐢🐍🐙🦀🐳🐬🌳🌲🌴🌵🌷🌹🌻🌼🍀"] },
  { name: "Food", emoji: [..."🍎🍐🍊🍋🍌🍉🍇🍓🫐🍒🍑🥭🍍🥥🥝🍅🥑🥦🥕🌽🥔🍞🥐🧀🥚🍳🥓🍔🍟🍕🌭🌮🌯🥗🍝🍜🍣🍤🍦🍰🎂🍫🍿☕🍵🍺🍷"] },
  { name: "Activity", emoji: [..."⚽🏀🏈⚾🎾🏐🏉🎱🏓🏸🥅⛳🏹🎣🥊🏆🥇🥈🥉🎖️🎯🎮🕹️🎲🎸🎹🥁🎤🎧🎬🎨"] },
  { name: "Travel", emoji: [..."🚗🚕🚙🚌🏎️🚓🚑🚒🚜🛵🏍️🚲🛴✈️🚀🛸🚁⛵🚢🏔️🏕️🏝️🏠🏢🗼🗽🌍🌆🌃🌉"] },
  { name: "Objects", emoji: [..."⌚📱💻⌨️🖥️🖨️💾💿📷🎥📞📟📺🔋🔌💡🔦📦📫✏️📝📚🔒🔑🔨🧰🧲💊🩺🧪🔬🔭📡"] },
  { name: "Symbols", emoji: [..."❤️🧡💛💚💙💜🖤🤍💔❣️💯✅❌⭕❗❓⚠️🚫♻️🔝🔥⭐🌟✨⚡☀️🌙☁️🌈❄️💧🎉🎊🎁"] },
];

export function EmojiPicker(props: { onPick: (emoji: string) => void; class?: string }) {
  const [open, setOpen] = createSignal(false);
  const [q, setQ] = createSignal("");
  const [group, setGroup] = createSignal(0);
  let root!: HTMLDivElement;

  onMount(() => {
    const away = (e: MouseEvent) => {
      if (open() && root && !root.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open()) {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    onCleanup(() => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    });
  });

  const shown = createMemo(() => {
    const needle = q().trim().toLowerCase();
    if (!needle) return GROUPS[group()]!.emoji;
    return GROUPS.filter((g) => g.name.toLowerCase().includes(needle)).flatMap((g) => g.emoji);
  });

  return (
    <div class={`relative ${props.class ?? ""}`} ref={root}>
      <button
        type="button"
        class="btn-ghost btn-icon-sm"
        aria-label="Insert an emoji"
        aria-expanded={open()}
        title="Emoji"
        onClick={() => setOpen((v) => !v)}
      >
        <Smile size={16} />
      </button>
      <Show when={open()}>
        <div class="card absolute bottom-10 right-0 z-30 w-[288px] p-2" role="dialog" aria-label="Emoji">
          <input
            class="input mb-2 h-7 w-full text-xs"
            placeholder="Search a group…"
            value={q()}
            onInput={(e) => setQ(e.currentTarget.value)}
          />
          <Show when={!q().trim()}>
            <div class="mb-2 flex gap-1 overflow-x-auto pb-1">
              <For each={GROUPS}>
                {(g, i) => (
                  <button
                    type="button"
                    class={`shrink-0 rounded-md px-2 py-0.5 text-[11px] ${group() === i() ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"}`}
                    onClick={() => setGroup(i())}
                  >
                    {g.name}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <div class="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto">
            <For each={shown()}>
              {(e) => (
                <button
                  type="button"
                  class="rounded-md py-1 text-lg leading-none hover:bg-surface-2"
                  onClick={() => {
                    props.onPick(e);
                    setOpen(false);
                  }}
                >
                  {e}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
