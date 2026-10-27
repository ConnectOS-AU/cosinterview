import "server-only";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

// Groq's Whisper translations endpoint: Tagalog, English or Taglish audio in,
// English text out, in one pass (translate first, as recruiters prefer).

export const STT_PROVIDER = "groq";
export const STT_MODEL = "whisper-large-v3";
// Groq bills per audio hour. Estimate only, for the cost column - check
// groq.com/pricing if it matters.
const USD_PER_AUDIO_HOUR = 0.111;

export type Segment = { startMs: number; endMs: number; text: string };

type VerboseSegment = {
  start: number;
  end: number;
  text: string;
  avg_logprob?: number;
  no_speech_prob?: number;
  compression_ratio?: number;
};

export function groqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export function translationCostUsd(durationSecs: number): number {
  // Groq bills a 10-second minimum per request.
  return Number(((Math.max(durationSecs, 10) / 3600) * USD_PER_AUDIO_HOUR).toFixed(5));
}

// Whisper invents text during silence and noise ("Thank you for watching",
// "Subscribe", repeated lines). Each participant has their own track, so long
// stretches of one track are silence while the other person talks - drop
// segments Whisper itself marks as unlikely speech, plus the usual phantom lines.
const PHANTOM = [
  /^thank(s| you)( so much)?( for watching| for listening)?[.!]*$/i,
  /subscribe/i,
  /^(bye|you)[.!]*$/i,
  /^\W*$/,
  /amara\.org|subtitles by/i,
];

function keep(seg: VerboseSegment): boolean {
  const text = seg.text.trim();
  if (!text) return false;
  if ((seg.no_speech_prob ?? 0) > 0.6 && (seg.avg_logprob ?? 0) < -0.5) return false;
  if ((seg.compression_ratio ?? 0) > 2.6) return false; // looping output
  if ((seg.avg_logprob ?? 0) < -1.2) return false;
  return !PHANTOM.some((p) => p.test(text));
}

export async function translateToEnglish(audioPath: string): Promise<Segment[]> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(await readFile(audioPath))], { type: "audio/ogg" }), basename(audioPath));
  form.append("model", STT_MODEL);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  // Steers Whisper towards the vocabulary of a recruitment interview.
  form.append("prompt", "A job interview between a ConnectOS recruiter and a candidate in the Philippines.");

  const res = await fetch("https://api.groq.com/openai/v1/audio/translations", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Groq translation failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { segments?: VerboseSegment[] };

  const kept: Segment[] = [];
  for (const seg of (json.segments ?? []).filter(keep)) {
    const text = seg.text.trim();
    // Collapse a line repeated back-to-back (another hallucination pattern).
    if (kept.at(-1)?.text === text) continue;
    kept.push({ startMs: Math.round(seg.start * 1000), endMs: Math.round(seg.end * 1000), text });
  }
  return kept;
}
