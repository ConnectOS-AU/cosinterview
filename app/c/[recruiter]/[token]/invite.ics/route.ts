import { DateTime } from "luxon";
import { invitePath, loadInvite, siteUrl } from "@/lib/invite";

// "Add to calendar" download for a booked interview.
export async function GET(_req: Request, { params }: { params: Promise<{ recruiter: string; token: string }> }) {
  const { recruiter, token } = await params;
  const invite = await loadInvite(recruiter, token);
  if (!invite || !invite.slotStart || !invite.slotEnd || (invite.status !== "booked" && invite.status !== "in_progress")) {
    return new Response("Not found", { status: 404 });
  }

  const stamp = (iso: string) => DateTime.fromISO(iso).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
  const escape = (text: string) => text.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const roomLink = `${siteUrl()}${invitePath(invite, token)}/room`;
  const title = `ConnectOS interview with ${invite.recruiter.displayName}`;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ConnectOS//Interviews//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${invite.bookingId}@interviews.connectos.co`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(invite.slotStart)}`,
    `DTEND:${stamp(invite.slotEnd)}`,
    `SUMMARY:${escape(title)}`,
    `DESCRIPTION:${escape(`Join your video interview here: ${roomLink}\nThe room opens 15 minutes before the start time.`)}`,
    `URL:${roomLink}`,
    `LOCATION:${escape(roomLink)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="connectos-interview.ics"',
      "Cache-Control": "no-store",
    },
  });
}
