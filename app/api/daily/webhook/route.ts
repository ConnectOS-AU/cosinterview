import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { processRecording, registerReadyRecording } from "@/lib/worker/process";

// Daily webhook (recording.ready-to-download). Register it once with
//   POST https://api.daily.co/v1/webhooks
//   { "url": "https://interviews.connectos.co/api/daily/webhook",
//     "eventTypes": ["recording.ready-to-download"], "hmac": "<DAILY_WEBHOOK_SECRET>" }
// Daily signs each call: base64(HMAC-SHA256(base64-decoded secret, "<timestamp>.<body>")).

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_SKEW_SECS = 5 * 60;

function validSignature(body: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env.DAILY_WEBHOOK_SECRET;
  if (!secret || !timestamp || !signature) return false;
  // Daily's timestamp header is in seconds or milliseconds depending on the event.
  const ts = Number(timestamp);
  const secs = ts > 1e12 ? ts / 1000 : ts;
  if (!Number.isFinite(secs) || Math.abs(Date.now() / 1000 - secs) > MAX_SKEW_SECS) return false;
  const expected = createHmac("sha256", Buffer.from(secret, "base64")).update(`${timestamp}.${body}`).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  const body = await request.text();
  if (!validSignature(body, request.headers.get("x-webhook-timestamp"), request.headers.get("x-webhook-signature"))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const event = JSON.parse(body) as { type?: string; test?: string; payload?: Record<string, unknown> };
  // Daily pings the endpoint with {"test":"test"} when the webhook is created.
  if (event.test || event.type !== "recording.ready-to-download" || !event.payload) return NextResponse.json({ ok: true });

  const recordingId = await registerReadyRecording(event.payload);
  // Answer Daily straight away; transcription carries on after the response.
  if (recordingId) after(() => processRecording(recordingId));
  return NextResponse.json({ ok: true });
}
