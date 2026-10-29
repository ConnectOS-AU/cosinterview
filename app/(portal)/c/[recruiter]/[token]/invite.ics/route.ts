import { icsFile } from "@/lib/calendar";
import { candidateCalendarEvent, loadInvite } from "@/lib/invite";

// "Add to calendar" download for a booked interview.
export async function GET(_req: Request, { params }: { params: Promise<{ recruiter: string; token: string }> }) {
  const { recruiter, token } = await params;
  const invite = await loadInvite(recruiter, token);
  const event = invite && (invite.status === "booked" || invite.status === "in_progress") ? candidateCalendarEvent(invite, token) : null;
  if (!event) return new Response("Not found", { status: 404 });

  return new Response(icsFile(event), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="connectos-interview.ics"',
      "Cache-Control": "no-store",
    },
  });
}
