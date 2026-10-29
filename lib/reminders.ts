import "server-only";
import { formatSlot, reminderEmail } from "./emails";
import { candidateCalendarEvent } from "./invite";
import { mailConfigured, mailForNote, sendCandidateMail } from "./mail";
import { messageCandidate } from "./messaging";
import {
  claimReminder,
  forgetOldInviteLinks,
  listUpcomingForReminders,
  type ReminderBooking,
  type ReminderKind,
  unclaimReminder,
} from "./repo";
import { logToJobAdder } from "./staff/jobadder-api";

// Candidate reminders by email (and WhatsApp / Viber when the candidate gave
// their numbers), 24 hours and 2 hours before the interview. Run
// from POST /api/worker/run (every 15 minutes), so each goes out within about
// 15 minutes of its time. A reminder is skipped when the candidate booked less
// than an hour before it was due - they've only just had their confirmation.

const HOUR = 3_600_000;
const REMINDERS: { kind: ReminderKind; hours: number }[] = [
  { kind: "2h", hours: 2 },
  { kind: "24h", hours: 24 },
];

// Which reminder (if any) is due for this booking right now.
export function dueReminder(booking: Pick<ReminderBooking, "bookedAt" | "sent"> & { slotStart: string }, now: Date): ReminderKind | null {
  const start = new Date(booking.slotStart).getTime();
  const bookedAt = booking.bookedAt ? new Date(booking.bookedAt).getTime() : 0;
  for (const { kind, hours } of REMINDERS) {
    const due = start - hours * HOUR;
    if (now.getTime() < due) continue;
    // Inside this reminder's window: send it unless done, or booked too late for it.
    if (booking.sent[kind] || bookedAt > due - HOUR) return null;
    return kind;
  }
  return null;
}

export async function sendDueReminders(now = new Date()): Promise<number> {
  const upcoming = await listUpcomingForReminders(now, 24);
  let sent = 0;
  for (const booking of upcoming) {
    const { invite } = booking;
    const numbers = { whatsapp: invite.candidateWhatsapp, viber: invite.candidateViber };
    if (!mailConfigured() && !numbers.whatsapp && !numbers.viber) continue;
    const kind = dueReminder({ ...booking, slotStart: invite.slotStart! }, now);
    if (!kind || !(await claimReminder(invite.bookingId, kind))) continue;

    const zone = invite.candidateTimezone ?? invite.recruiter.timezone;
    const when = formatSlot(invite.slotStart!, invite.slotEnd!, zone);
    const roomLink = booking.token ? (candidateCalendarEvent(invite, booking.token)?.url ?? null) : null;
    let emailNote: string | null = null;
    if (mailConfigured()) {
      const content = reminderEmail({
        kind,
        candidateName: invite.candidateName,
        recruiterName: invite.recruiter.displayName,
        recruiterTitle: invite.recruiter.title,
        jobTitle: invite.interview.jobTitle,
        when,
        roomLink,
      });
      const mail = {
        to: { name: invite.candidateName, email: invite.candidateEmail },
        recruiter: { name: invite.recruiter.displayName, email: invite.recruiter.calendarEmail },
        subject: content.subject,
        html: content.bodyHtml,
        text: content.text,
      };
      try {
        await sendCandidateMail(mail);
        emailNote = mailForNote(mail);
      } catch (err) {
        console.error(`[reminder] ${kind} email failed`, invite.bookingId, err);
      }
    }
    const messageNote = await messageCandidate(
      numbers,
      [
        `Hi ${invite.candidateName.split(" ")[0]}, a reminder: your ConnectOS interview${invite.interview.jobTitle ? ` for ${invite.interview.jobTitle}` : ""} with ${invite.recruiter.displayName} is ${kind === "24h" ? "tomorrow" : "in 2 hours"} - ${when}.`,
        roomLink ? `Join the video call here (it opens 15 minutes before): ${roomLink}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    // Neither went out (an email failure and no numbers): try again next run.
    if (!emailNote && !messageNote) {
      await unclaimReminder(invite.bookingId, kind);
      continue;
    }
    sent++;
    const label = kind === "24h" ? "24-hour" : "2-hour";
    await logToJobAdder(
      invite.jobadderCandidateId,
      [`${label} interview reminder sent via COSInterview.`, emailNote, messageNote].filter(Boolean).join("\n\n"),
    );
  }
  await forgetOldInviteLinks(now);
  return sent;
}
