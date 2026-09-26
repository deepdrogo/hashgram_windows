// Measuring a video before it is posted.
//
// Pictures are decoded on the Rust side, where the pixels can be trusted.
// Video is different: shipping a decoder with the app would mean shipping a
// transcoder, and a central "upload service" that makes thumbnails is
// exactly the kind of middle the network does not have. The webview already
// has a decoder — <video> — so it measures the file and grabs one frame,
// and Rust re-encodes that frame before it goes anywhere.
import { convertFileSrc } from "@tauri-apps/api/core";

export interface ClientMeta {
  width: number;
  height: number;
  duration_ms: number;
  /** A JPEG of the first usable frame, base64, without the data: prefix. */
  poster_base64: string;
}

const EMPTY: ClientMeta = { width: 0, height: 0, duration_ms: 0, poster_base64: "" };

export function isVideo(path: string): boolean {
  return /\.(mp4|webm|mov|mkv|m4v)$/i.test(path);
}

/** Size, duration and a poster frame, or zeroes if the file will not play. */
export async function measureVideo(path: string): Promise<ClientMeta> {
  if (!isVideo(path)) return EMPTY;
  const el = document.createElement("video");
  el.preload = "metadata";
  el.muted = true;
  el.src = convertFileSrc(path);
  try {
    await once(el, "loadedmetadata", 8000);
    const meta: ClientMeta = {
      width: el.videoWidth,
      height: el.videoHeight,
      duration_ms: Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0,
      poster_base64: "",
    };
    // A tenth of a second in: the very first frame is often black.
    el.currentTime = Math.min(0.1, (el.duration || 1) / 10);
    await once(el, "seeked", 8000).catch(() => undefined);
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    const ctx = canvas.getContext("2d");
    if (ctx && canvas.width && canvas.height) {
      ctx.drawImage(el, 0, 0);
      meta.poster_base64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1] ?? "";
    }
    return meta;
  } catch {
    return EMPTY;
  } finally {
    el.removeAttribute("src");
    el.load();
  }
}

function once(el: HTMLElement, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${event} timed out`));
    }, ms);
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error(event));
    };
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(event, ok);
      el.removeEventListener("error", fail);
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", fail, { once: true });
  });
}
