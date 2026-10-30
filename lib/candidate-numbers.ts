import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import { demoMode } from "./demo";
import { normalisePhone } from "./messaging";
import { downloadResumeVersion, listResumeVersions, versionForReview } from "./resumes";
import { supabaseAdmin } from "./supabase/admin";
import type { InviteRecord } from "./types";

// WhatsApp and Viber numbers to fill in on the candidate's booking screen, for
// them to check, change or clear: a number their resume labels as WhatsApp or
// Viber, otherwise the mobile on their JobAdder profile (from the synced
// ja_candidates table). Nothing is saved until they book.
//
// Word and text resumes are searched directly; a PDF resume is read by Claude
// (asked only for numbers labelled WhatsApp or Viber), when ANTHROPIC_API_KEY
// is set. Results are held for a few hours so reloading the page is instant.

export type SuggestedNumbers = { whatsapp: string | null; viber: string | null; from: ("profile" | "resume")[] };

const NONE: SuggestedNumbers = { whatsapp: null, viber: null, from: [] };
const CACHE_MS = 6 * 3_600_000;
const EXTRACT_MODEL = "claude-haiku-5-5";
const cache = globalThis as typeof globalThis & { __cosrecNumbers?: Map<string, { at: number; value: SuggestedNumbers }> };

type Found = { whatsapp: string | null; viber: string | null };

const LABEL = String.raw`(?:whats\s*app|viber)`;
const LABELS = String.raw`${LABEL}(?:\s*(?:\/|&|and|or|,|\+)\s*${LABEL})*`;
const NUMBER = String.raw`\+?\(?\d[\d\s().-]{6,18}\d`;
// "WhatsApp: 0917 123 4567", "Viber/WhatsApp no. +63 917...", "0917 123 4567 (WhatsApp)"
const LABEL_FIRST = new RegExp(String.raw`(${LABELS})\s*(?:no\.?|number|#)?\s*[:\-–]?\s*(${NUMBER})`, "gi");
const NUMBER_FIRST = new RegExp(String.raw`(${NUMBER})\s*[(\[\-–]?\s*(${LABELS})`, "gi");

// Numbers a resume's text labels as WhatsApp or Viber. Other phone numbers are ignored.
export function numbersInText(text: string): Found {
  const found: Found = { whatsapp: null, viber: null };
  const take = (labels: string, raw: string) => {
    const number = normalisePhone(raw);
    if (!number) return;
    if (/whats/i.test(labels)) found.whatsapp ??= number;
    if (/viber/i.test(labels)) found.viber ??= number;
  };
  for (const m of text.matchAll(LABEL_FIRST)) take(m[1]!, m[2]!);
  for (const m of text.matchAll(NUMBER_FIRST)) take(m[2]!, m[1]!);
  return found;
}

async function profileMobile(candidateId: string): Promise<string | null> {
  if (!/^\d+$/.test(candidateId)) return null;
  const { data, error } = await supabaseAdmin().from("ja_candidates").select("mobile").eq("candidate_id", candidateId).maybeSingle();
  if (error) throw new Error(`Candidate lookup failed: ${error.message}`);
  return typeof data?.mobile === "string" ? normalisePhone(data.mobile) : null;
}

const PDF_SCHEMA = {
  type: "object",
  properties: {
    whatsapp: { type: ["string", "null"], description: "The number the resume labels as WhatsApp, as written, or null." },
    viber: { type: ["string", "null"], description: "The number the resume labels as Viber, as written, or null." },
  },
  required: ["whatsapp", "viber"],
  additionalProperties: false,
};

let client: Anthropic | null = null;

async function numbersInPdf(base64: string): Promise<Found> {
  client ??= new Anthropic();
  const response = await client.beta.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 300,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { format: { type: "json_schema", schema: PDF_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          {
            type: "text",
            text: "From this resume, give the phone number labelled as WhatsApp and the one labelled as Viber (a number labelled for both goes in both). Only numbers the resume explicitly marks as WhatsApp or Viber - not other phone or mobile numbers. Null when there isn't one.",
          },
        ],
      },
    ],
  });
  if (response.stop_reason !== "end_turn") return { whatsapp: null, viber: null };
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const raw = JSON.parse(text) as { whatsapp: string | null; viber: string | null };
  return { whatsapp: raw.whatsapp ? normalisePhone(raw.whatsapp) : null, viber: raw.viber ? normalisePhone(raw.viber) : null };
}

async function resumeNumbers(candidateId: string): Promise<Found> {
  const none = { whatsapp: null, viber: null };
  const version = versionForReview((await listResumeVersions(candidateId)).versions);
  if (!version) return none;
  const file = await downloadResumeVersion(candidateId, version);
  if (file.format === "docx") return numbersInText((await mammoth.extractRawText({ buffer: file.bytes })).value);
  if (file.format === "text") return numbersInText(file.bytes.toString("utf8"));
  if (file.format === "pdf" && process.env.ANTHROPIC_API_KEY) return numbersInPdf(file.bytes.toString("base64"));
  return none;
}

// Each source is optional: a failure is logged and the other still counts.
async function lookUp(invite: InviteRecord): Promise<SuggestedNumbers> {
  if (demoMode()) {
    return invite.jobadderCandidateId === "5001"
      ? { whatsapp: "+639175550123", viber: "+639187774321", from: ["profile", "resume"] }
      : NONE;
  }
  const [mobile, resume] = await Promise.all([
    profileMobile(invite.jobadderCandidateId).catch((err) => {
      console.error("[numbers] Profile mobile lookup failed", invite.bookingId, err);
      return null;
    }),
    resumeNumbers(invite.jobadderCandidateId).catch((err) => {
      console.error("[numbers] Resume search failed", invite.bookingId, err);
      return { whatsapp: null, viber: null };
    }),
  ]);
  const from: SuggestedNumbers["from"] = [];
  if (resume.whatsapp || resume.viber) from.push("resume");
  if (mobile && (!resume.whatsapp || !resume.viber)) from.push("profile");
  return { whatsapp: resume.whatsapp ?? mobile, viber: resume.viber ?? mobile, from };
}

export async function suggestNumbers(invite: InviteRecord): Promise<SuggestedNumbers> {
  const store = (cache.__cosrecNumbers ??= new Map());
  const hit = store.get(invite.bookingId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await lookUp(invite);
  store.set(invite.bookingId, { at: Date.now(), value });
  if (store.size > 2000) store.delete(store.keys().next().value!);
  return value;
}
