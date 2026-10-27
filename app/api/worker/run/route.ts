import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processDueRecordings } from "@/lib/worker/process";

// Retries recordings that failed or got stuck. Call it every 15 minutes from
// the server's scheduler (cron, pm2, Task Scheduler):
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
  const processed = await processDueRecordings();
  return NextResponse.json({ processed });
}
