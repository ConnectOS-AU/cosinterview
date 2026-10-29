import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processDueReviews } from "@/lib/candidate-review";
import { demoMode } from "@/lib/demo";
import { sendDueReminders } from "@/lib/reminders";
import { processDueRecordings } from "@/lib/worker/process";

// Sends candidates' interview reminders (24 hours and 2 hours before), writes
// candidate overviews that are missing or failed, and retries recordings that
// failed or got stuck. Call it every 15 minutes from
// ONE server's scheduler (cron, pm2, Task Scheduler):
//   curl -X POST -H "Authorization: Bearer $WORKER_SECRET" https://interviews.connectos.co/api/worker/run

export const runtime = "nodejs";
export const maxDuration = 900;

function authorised(header: string | null): boolean {
  const secret = process.env.WORKER_SECRET;
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: Request) {
  if (!authorised(request.headers.get("authorization"))) return new NextResponse("Unauthorized", { status: 401 });
  // Reminders first: they're quick and time-sensitive, and a recording that
  // takes a while to process shouldn't hold them up.
  let reminders: number | string = 0;
  try {
    reminders = await sendDueReminders();
  } catch (err) {
    console.error("[worker] Reminders failed", err);
    reminders = "failed";
  }
  let reviews: number | string = 0;
  try {
    reviews = await processDueReviews();
  } catch (err) {
    console.error("[worker] Candidate reviews failed", err);
    reviews = "failed";
  }
  const processed = demoMode() ? 0 : await processDueRecordings();
  return NextResponse.json({ reminders, reviews, processed });
}
