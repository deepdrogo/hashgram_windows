// Stage 2 surfaces (Messages, Feed, Reels, Channels, Calls). Until they
// land, each says so plainly rather than showing a fake empty state.
import { Notice } from "~/components/ui";

const TEXT: Record<string, string> = {
  Messages: "End-to-end encrypted chats over MLS with store-and-forward mailboxes. Arrives in Stage 2 of this build.",
  Feed: "Chronological feed of accounts you follow; every event signature-verified against on-chain devices. Stage 2.",
  Reels: "Vertical video, chunked and hash-verified from store/media nodes. Stage 2.",
  Channels: "Broadcast channels as signed social events. Stage 2.",
  Calls: "1:1 calls through TURN nodes discovered on the network; group calls only when an SFU is announced (and not end-to-end encrypted against the SFU operator). Stage 2.",
};

export function Stage2(props: { title: string }) {
  return (
    <div class="page flex flex-col gap-4">
      <h1 class="page-title">{props.title}</h1>
      <Notice title="Not in this stage yet">{TEXT[props.title] ?? "Arrives in Stage 2."}</Notice>
    </div>
  );
}
