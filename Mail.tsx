
/**
 * Your mail address, where a mail client puts it.
 *
 * With a username registered, that is `@name` and `name@hashgram.io`.
 * Without one it is the hash1 address, which works but nobody can type,
 * so the card offers the one thing that fixes it — and sends the user to
 * My profile, not to the wallet, because a username is who you are.
 */
function MailIdentity() {
  const navigate = useNavigate();
  const id = () => store.identity();
  const username = () => id()?.username ?? "";
  const address = () => id()?.address ?? store.status()?.address ?? "";
  return (
    <div class="border-b border-border px-3 py-2.5">
      <Show
        when={username()}
        fallback={
          <>
            <p class="text-[11px] uppercase tracking-wide text-muted">Your address</p>
            <Mono text={address()} head={10} tail={6} copy class="mt-0.5 text-xs" />
            <Button class="mt-2 w-full" size="sm" variant="secondary" onClick={() => navigate("/profile/me")}>
              Choose a username
            </Button>
          </>
        }
      >
        <p class="text-[13px] font-medium">@{username()}</p>
        <button
          type="button"
          class="mt-0.5 flex w-full items-center gap-1 text-left text-xs text-muted hover:text-fg"
          title="Copy"
          onClick={() => void copyText(`${username()}@hashgram.io`)}
        >
          <span class="truncate">{username()}@hashgram.io</span>
          <CopyIcon size={11} class="shrink-0" />
        </button>
      </Show>
    </div>
  );
}