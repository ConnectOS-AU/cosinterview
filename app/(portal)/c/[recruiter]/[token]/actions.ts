"use server";

import { DateTime } from "luxon";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { googleCalendarUrl, icsFile, outlookCalendarUrl } from "@/lib/calendar";
import { demoMode } from "@/lib/demo";
import { bookingConfirmationEmail, formatSlot, recruiterEventBody } from "@/lib/emails";
import { createInterviewEvent, graphConfigured } from "@/lib/graph";
import {
  availableSlots,
  candidateCalendarEvent,
  invitePath,
  inviteExpired,
  joinWindow,
  loadInvite,
  siteUrl,
} from "@/lib/invite";
import { mailConfigured, mailForNote, sendCandidateMail } from "@/lib/mail";
import { messageCandidate, normalisePhone } from "@/lib/messaging";
import { allowRequest } from "@/lib/rate-limit";
import { claimSlot, saveCandidateNumbers, saveGraphEvent, saveInviteLink } from "@/lib/repo";
import { roomForBooking } from "@/lib/rooms";
import { runCandidateReview } from "@/lib/candidate-review";
import { logToJobAdder } from "@/lib/staff/jobadder-api";
import type { InviteRecord } from "@/lib/types";

async function clientKey(action: string): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return `${action}:${ip}`;
}

function validTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

export type BookResult = { ok: true } | { ok: false; error: string; refresh?: boolean };

export async function bookInterview(input: {
  recruiter: string;
  token: string;
  slotStart: string;
  timezone: string;
  consent: boolean;
  whatsapp?: string;
  viber?: string;
}): Promise<BookResult> {
  if (!allowRequest(await clientKey("book"), 10, 60_000)) {
    return { ok: false, error: "Too many attempts. Please wait a minute and try again." };
  }
  const invite = await loadInvite(input.recruiter, input.token);
  if (!invite) return { ok: false, error: "This invite link isn't valid." };
  if (invite.status !== "invited") return { ok: false, error: "This interview is already booked.", refresh: true };
  if (inviteExpired(invite) || invite.interview.status !== "open") {
    return { ok: false, error: "This invite has expired. Please contact your recruiter.", refresh: true };
  }
  if (!input.consent) return { ok: false, error: "Please agree to the interview being recorded to continue." };
  const whatsapp = input.whatsapp?.trim() ? normalisePhone(input.whatsapp) : null;
  if (input.whatsapp?.trim() && !whatsapp) return { ok: false, error: "Please check your WhatsApp number, or leave it empty." };
  const viber = input.viber?.trim() ? normalisePhone(input.viber) : null;
  if (input.viber?.trim() && !viber) return { ok: false, error: "Please check your Viber number, or leave it empty." };

  // Re-check against live availability: the slot may have gone since the page loaded.
  const slots = await availableSlots(invite);
  const start = DateTime.fromISO(input.slotStart, { zone: "utc" });
  const startIso = start.isValid ? start.toISO() : null;
  if (!startIso || !slots.includes(startIso)) {
    return { ok: false, error: "Sorry, that time has just been taken. Please pick another.", refresh: true };
  }
  const endIso = start.plus({ minutes: invite.interview.durationMins }).toISO()!;

  const claimed = await claimSlot(invite.bookingId, {
    slotStart: startIso,
    slotEnd: endIso,
    candidateTimezone: validTimezone(input.timezone) ? input.timezone : invite.recruiter.timezone,
    consentAt: new Date().toISOString(),
  });
  if (claimed === "taken") {
    return { ok: false, error: "Sorry, that time has just been taken. Please pick another.", refresh: true };
  }
  if (claimed !== "ok") return { ok: false, error: "This interview is already booked.", refresh: true };
  if (whatsapp || viber || invite.candidateWhatsapp || invite.candidateViber) {
    try {
      await saveCandidateNumbers(invite.bookingId, { whatsapp, viber });
    } catch (err) {
      console.error("[book] Saving WhatsApp/Viber numbers failed", invite.bookingId, err);
    }
  }

  // The booking is saved. Everything else is best-effort and runs after the
  // candidate's page has its answer: a failure is logged for follow-up rather
  // than undoing the booking, and the room is created again on join if needed.
  const booked: InviteRecord = {
    ...invite,
    status: "booked",
    slotStart: startIso,
    slotEnd: endIso,
    candidateTimezone: validTimezone(input.timezone) ? input.timezone : invite.recruiter.timezone,
    candidateWhatsapp: whatsapp,
    candidateViber: viber,
  };
  after(() => afterBooking(booked, input.token));

  revalidatePath(invitePath(invite, input.token));
  return { ok: true };
}

async function afterBooking(booked: InviteRecord, token: string): Promise<void> {
  const { recruiter, interview } = booked;
  const start = booked.slotStart!;
  const end = booked.slotEnd!;
  const candidateZone = booked.candidateTimezone ?? recruiter.timezone;
  const recruiterWhen = formatSlot(start, end, recruiter.timezone);
  const candidateWhen = formatSlot(start, end, candidateZone);

  try {
    await roomForBooking(booked);
  } catch (err) {
    console.error("[book] Daily room setup failed", booked.bookingId, err);
  }
  try {
    await saveInviteLink(booked.bookingId, token);
  } catch (err) {
    console.error("[book] Saving the link for reminders failed", booked.bookingId, err);
  }

  if (graphConfigured()) {
    // 1. The recruiter's Outlook entry, linking to their interview screen.
    try {
      const link = `${siteUrl()}/r/bookings/${booked.bookingId}`;
      const eventId = await createInterviewEvent(recruiter.calendarEmail, {
        subject: `Interview: ${booked.candidateName}${interview.jobTitle ? ` – ${interview.jobTitle}` : ""}`,
        bodyHtml: recruiterEventBody({
          candidateName: booked.candidateName,
          candidateEmail: booked.candidateEmail,
          jobTitle: interview.jobTitle,
          clientName: interview.clientName,
          candidateWhen: candidateZone === recruiter.timezone ? null : candidateWhen,
          link,
        }),
        start,
        end,
        link,
      });
      await saveGraphEvent(booked.bookingId, eventId);
    } catch (err) {
      console.error("[book] Outlook event creation failed", booked.bookingId, err);
    }
  }

  // 2. The candidate's confirmation, with the calendar file attached.
  const event = candidateCalendarEvent(booked, token)!;
  const bookingPage = `${siteUrl()}${invitePath(booked, token)}`;
  let emailNote: string | null = null;
  if (mailConfigured()) {
    try {
      const content = bookingConfirmationEmail({
        candidateName: booked.candidateName,
        recruiterName: recruiter.displayName,
        recruiterTitle: recruiter.title,
        jobTitle: interview.jobTitle,
        when: candidateWhen,
        bookingPage,
        roomLink: event.url,
        googleUrl: googleCalendarUrl(event),
        outlookUrl: outlookCalendarUrl(event),
      });
      const mail = {
        to: { name: booked.candidateName, email: booked.candidateEmail },
        recruiter: { name: recruiter.displayName, email: recruiter.calendarEmail },
        subject: content.subject,
        html: content.bodyHtml,
        text: content.text,
        attachments: [{ filename: "connectos-interview.ics", contentType: "text/calendar", content: icsFile(event) }],
      };
      await sendCandidateMail(mail);
      emailNote = mailForNote(mail);
    } catch (err) {
      console.error("[book] Confirmation email failed", booked.bookingId, err);
    }
  }

  // ...and on WhatsApp / Viber, if they gave their numbers.
  const messageNote = await messageCandidate(
    { whatsapp: booked.candidateWhatsapp, viber: booked.candidateViber },
    [
      `Hi ${booked.candidateName.split(" ")[0]}, your ConnectOS interview${interview.jobTitle ? ` for ${interview.jobTitle}` : ""} with ${recruiter.displayName} is booked for ${candidateWhen}.`,
      `Join the video call here (it opens 15 minutes before): ${event.url}`,
      `To see or change your booking: ${bookingPage}`,
    ].join("\n"),
  );

  // 3. JobAdder: the time the candidate chose, and the confirmation they got.
  const summary = [
    `Interview booked by the candidate via COSInterview${interview.jobTitle ? ` for ${interview.jobTitle}` : ""}.`,
    `When: ${recruiterWhen}${candidateZone === recruiter.timezone ? "" : ` / candidate's time: ${candidateWhen}`}`,
    `Length: ${interview.durationMins} minutes. Recruiter: ${recruiter.displayName}.`,
  ].join("\n");
  await logToJobAdder(booked.jobadderCandidateId, [summary, emailNote, messageNote].filter(Boolean).join("\n\n"));

  // 4. The candidate overview for the recruiter (resume and notes against the
  // job description), also added to JobAdder. Last, as it takes a minute.
  await runCandidateReview(booked);
}

export type RoomAccess =
  | { ok: true; roomUrl: string | null; candidateName: string; bookingId: string }
  | { ok: false; reason: "invalid" | "not_booked" | "too_early" | "closed" | "unavailable" };

// Hands the candidate's page the room URL, only inside the join window. The
// candidate gets no meeting token, so Daily holds them in the lobby until the
// recruiter admits them. roomUrl is null in local dev without Daily credentials.
export async function getRoomAccess(recruiter: string, token: string): Promise<RoomAccess> {
  if (!allowRequest(await clientKey("room"), 30, 60_000)) return { ok: false, reason: "unavailable" };
  const invite = await loadInvite(recruiter, token);
  if (!invite) return { ok: false, reason: "invalid" };
  if (invite.status !== "booked" && invite.status !== "in_progress") return { ok: false, reason: "not_booked" };
  const window = joinWindow(invite);
  if (!window) return { ok: false, reason: "not_booked" };
  const now = DateTime.utc();
  // The local demo skips the time check so the lobby can be tried straight away.
  if (!demoMode()) {
    if (now < window.opens) return { ok: false, reason: "too_early" };
    if (now > window.closes) return { ok: false, reason: "closed" };
  }

  try {
    const room = await roomForBooking(invite);
    return { ok: true, roomUrl: room?.url ?? null, candidateName: invite.candidateName, bookingId: invite.bookingId };
  } catch (err) {
    console.error("[room] Daily room setup failed", invite.bookingId, err);
    return { ok: false, reason: "unavailable" };
  }
}
