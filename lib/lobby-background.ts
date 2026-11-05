import type DailyIframe from "@daily-co/daily-js";
import type { DailyCall, DailyInputVideoProcessorSettings } from "@daily-co/daily-js";

// The candidate's or attendee's virtual background. Runs in their browser only: an
// uploaded image is kept on their device and handed to Daily as bytes, so a
// personal photo never reaches the public storage bucket.
export type Background = { kind: "off" } | { kind: "blur" } | { kind: "image"; dataUrl: string };

const KEY = "cosinterview-background";
const LONGEST_SIDE = 1280;

// Also kept here because browser storage can be full or blocked.
let chosen: Background | null = null;

export function savedBackground(): Background {
  if (chosen) return chosen;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Background | null;
    if (saved?.kind === "blur" || (saved?.kind === "image" && saved.dataUrl.startsWith("data:image/jpeg"))) return saved;
  } catch {
    // Nothing usable saved.
  }
  return { kind: "off" };
}

export function saveBackground(background: Background) {
  chosen = background;
  try {
    localStorage.setItem(KEY, JSON.stringify(background));
  } catch {
    // Still applies for as long as this page is open.
  }
}

export function processorFor(background: Background): DailyInputVideoProcessorSettings {
  if (background.kind === "blur") return { type: "background-blur", config: { strength: 0.7 } };
  if (background.kind === "image") {
    const binary = atob(background.dataUrl.split(",")[1] ?? "");
    return { type: "background-image", config: { source: Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer } };
  }
  return { type: "none" };
}

// For call.join, so the real room is never shown first.
export function joinBackground(Daily: typeof DailyIframe) {
  const background = savedBackground();
  if (background.kind === "off" || !Daily.supportedBrowser().supportsVideoProcessing) return {};
  return { inputSettings: { video: { processor: processorFor(background) } } };
}

// Daily turns the camera off when an effect fails, rather than show the room.
export function followBackground(call: DailyCall, onFailed: () => void) {
  call.on("nonfatal-error", (e) => {
    if (e?.type === "input-settings-error" || e?.type === "video-processor-error") onFailed();
  });
}

// A smaller JPEG, which is the format Daily needs and fits in browser storage.
export async function imageForBackground(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
