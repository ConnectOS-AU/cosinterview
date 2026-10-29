import "server-only";
import { demoMode } from "./demo";

// Candidate notifications on WhatsApp and Viber, through Infobip, alongside
// the emails: booking confirmation, reminders, a moved interview and a
// cancellation. Only for candidates who gave their numbers when booking.
// Without Infobip settings (or with MESSAGING_DRY_RUN=true, and in the local
// demo) the message is logged instead of sent.
//
// Settings: INFOBIP_BASE_URL (e.g. https://xxxxx.api.infobip.com),
// INFOBIP_API_KEY, INFOBIP_WHATSAPP_SENDER (the WhatsApp business number),
// INFOBIP_WHATSAPP_TEMPLATE (an approved template whose body is a single
// {{1}} placeholder - default "cosinterview_update"), INFOBIP_WHATSAPP_LANGUAGE
// (default "en"), and INFOBIP_VIBER_SENDER (the Viber business sender name).
//
// WhatsApp only allows messages a business starts through templates Meta has
// approved, and template values can't contain line breaks - so the WhatsApp
// text is one line. Viber gets the text as written.
//
// UNVERIFIED: Infobip's request formats (POST /whatsapp/1/message/template and
// POST /viber/2/messages) were written from their documentation without a test
// account; check the first real messages arrive.

export type Channel = "whatsapp" | "viber";
export type CandidateNumbers = { whatsapp: string | null; viber: string | null };

const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", viber: "Viber" };

const dryRun = () => demoMode() || process.env.MESSAGING_DRY_RUN === "true";
const base = () => process.env.INFOBIP_BASE_URL?.replace(/\/+$/, "") ?? "";

function configured(channel: Channel): boolean {
  if (dryRun()) return true;
  if (!base() || !process.env.INFOBIP_API_KEY) return false;
  return channel === "whatsapp" ? Boolean(process.env.INFOBIP_WHATSAPP_SENDER) : Boolean(process.env.INFOBIP_VIBER_SENDER);
}

// A phone number as typed, made international: "0917 123 4567" and
// "+63 917 123 4567" both become "+639171234567". Numbers from other countries
// need their + and country code. Returns null if it doesn't look like a number.
export function normalisePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d]/g, "");
  let e164: string;
  if (trimmed.startsWith("+")) e164 = digits;
  else if (digits.startsWith("00")) e164 = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) e164 = `63${digits.slice(1)}`; // Philippine 09xx
  else if (digits.startsWith("9") && digits.length === 10) e164 = `63${digits}`; // Philippine 9xx without the 0
  else e164 = digits;
  return /^[1-9]\d{7,14}$/.test(e164) ? `+${e164}` : null;
}

async function infobip(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { Authorization: `App ${process.env.INFOBIP_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Infobip ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
}

async function send(channel: Channel, to: string, text: string): Promise<void> {
  const number = to.replace(/^\+/, "");
  if (dryRun()) {
    console.info(`[${channel} dry-run] To: ${to}\n${channel === "whatsapp" ? oneLine(text) : text}\n`);
    return;
  }
  if (channel === "whatsapp") {
    await infobip("/whatsapp/1/message/template", {
      messages: [
        {
          from: process.env.INFOBIP_WHATSAPP_SENDER,
          to: number,
          content: {
            templateName: process.env.INFOBIP_WHATSAPP_TEMPLATE || "cosinterview_update",
            templateData: { body: { placeholders: [oneLine(text)] } },
            language: process.env.INFOBIP_WHATSAPP_LANGUAGE || "en",
          },
        },
      ],
    });
  } else {
    await infobip("/viber/2/messages", {
      messages: [{ sender: process.env.INFOBIP_VIBER_SENDER, destinations: [{ to: number }], content: { type: "TEXT", text } }],
    });
  }
}

// WhatsApp template values: no line breaks or tabs, no runs of spaces, 1024 characters at most.
const oneLine = (text: string) => text.replace(/\s*\n+\s*/g, " - ").replace(/\s{2,}/g, " ").slice(0, 1024);

// Sends the text to each number the candidate gave. Never throws. Returns a
// line for the JobAdder note ("Also sent by WhatsApp to +63..., Viber failed"),
// or null when there was nothing to send to.
export async function messageCandidate(numbers: CandidateNumbers, text: string): Promise<string | null> {
  const results: string[] = [];
  for (const channel of ["whatsapp", "viber"] as const) {
    const to = numbers[channel];
    if (!to) continue;
    if (!configured(channel)) {
      results.push(`${CHANNEL_LABEL[channel]} (${to}) not sent - ${CHANNEL_LABEL[channel]} messaging isn't set up yet`);
      continue;
    }
    try {
      await send(channel, to, text);
      results.push(`sent by ${CHANNEL_LABEL[channel]} to ${to}`);
    } catch (err) {
      console.error(`[${channel}]`, to, err);
      results.push(`${CHANNEL_LABEL[channel]} to ${to} failed`);
    }
  }
  return results.length ? `Message: ${results.join("; ")}.\n${text}` : null;
}
