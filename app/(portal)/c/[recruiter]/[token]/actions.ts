"use server";

import { DateTime } from "luxon";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { googleCalendarUrl, icsFile, outlookCalendarUrl } from "@/lib/calendar";
import { demoMode } from "@/lib/demo";
import { bookingConfirmationEmail, candidateVars, formatSlot, messageText, recruiterBookingEmail, recruiterEventBody } from "@/lib/emails";
import { createInterviewEvent, deleteInterviewEvent, graphConfigured } from "@/lib/graph";
import {
  availableSlots,
  canChangeTime,
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
import { claimSlot, moveSlot, saveCandidateNumbers, saveGraphEvent, saveInviteLink } from "@/lib/repo";
import { createCandidateToken, recruiterStartedEarly } from "@/lib/daily";
import { roomForBooking } from "@/lib/rooms";
import { runCandidateReview } from "@/lib/candidate-review";
import { recordArrival } from "@/lib/punctuality";
import { suggestNumbers, type SuggestedNumbers } from "@/lib/candidate-numbers";
import { logToJobAdder } from "@/lib/staff/jobadder-api";
import { listGuests } from "@/lib/guests";
import { stageLabel } from "@/lib/stages";
import type { InviteRecord } from "@/lib/types";

async function clientKey(action: string): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return `${action}:${ip}`;
}

function validTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

// Numbers to fill in on the booking screen (from the candidate's JobAdder
// profile and resume), for them to check. Only before they've booked.
export async function suggestedNumbers(recruiter: string, token: string): Promise<SuggestedNumbers> {
  const none: SuggestedNumbers = { whatsapp: null, viber: null, from: [] };
  if (!allowRequest(await clientKey("numbers"), 10, 60_000)) return none;
  const invite = await loadInvite(recruiter, token);
  if (!invite || invite.status !== "invited" || inviteExpired(invite)) return none;
  try {
    return await suggestNumbers(invite);
  } catch (err) {
    console.error("[numbers]", invite.bookingId, err);
    return none;
  }
}

export type BookResult = { ok: true } | { ok: false; error: string; refresh?: boolean };

const SLOT_TAKEN = "Sorry, that time has just been taken. Please pick another.";

function parseNumbers(input: { whatsapp?: string; viber?: string }): { whatsapp: string | null; viber: string | null } | { error: string } {
  const whatsapp = input.whatsapp?.trim() ? normalisePhone(input.whatsapp) : null;
  if (input.whatsapp?.trim() && !whatsapp) return { error: "Please check your WhatsApp number, or leave it empty." };
  const viber = input.viber?.trim() ? normalisePhone(input.viber) : null;
  if (input.viber?.trim() && !viber) return { error: "Please check your Viber number, or leave it empty." };
  return { whatsapp, viber };
}

// The chosen time, re-checked against live availability: it may have gone since
// the page loaded.
async function pickedSlot(invite: InviteRecord, slotStart: string): Promise<{ startIso: string; endIso: string } | null> {
  const slots = await availableSlots(invite);
  const start = DateTime.fromISO(slotStart, { zone: "utc" });
  const startIso = start.isValid ? start.toISO() : null;
  if (!startIso || !slots.includes(startIso)) return null;
  return { startIso, endIso: start.plus({ minutes: invite.interview.durationMins }).toISO()! };
}

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
  const numbers = parseNumbers(input);
  if ("error" in numbers) return { ok: false, error: numbers.error };
  const { whatsapp, viber } = numbers;

  const picked = await pickedSlot(invite, input.slotStart);
  if (!picked) return { ok: false, error: SLOT_TAKEN, refresh: true };
  const { startIso, endIso } = picked;

  const claimed = await claimSlot(invite.bookingId, {
    slotStart: startIso,
    slotEnd: endIso,
    candidateTimezone: validTimezone(input.timezone) ? input.timezone : invite.recruiter.timezone,
    consentAt: new Date().toISOString(),
  });
  if (claimed === "taken") return { ok: false, error: SLOT_TAKEN, refresh: true };
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

// The candidate moving their own booking. Their current time stays booked unless
// the new one is free.
export async function changeInterviewTime(input: {
  recruiter: string;
  token: string;
  slotStart: string;
  timezone: string;
  whatsapp?: string;
  viber?: string;
}): Promise<BookResult> {
  if (!allowRequest(await clientKey("book"), 10, 60_000)) {
    return { ok: false, error: "Too many attempts. Please wait a minute and try again." };
  }
  const invite = await loadInvite(input.recruiter, input.token);
  if (!invite) return { ok: false, error: "This invite link isn't valid." };
  if (!canChangeTime(invite)) {
    return { ok: false, error: "This interview can't be moved online now. Please reply to your invitation email.", refresh: true };
  }
  const numbers = parseNumbers(input);
  if ("error" in numbers) return { ok: false, error: numbers.error };
  const picked = await pickedSlot(invite, input.slotStart);
  if (!picked) return { ok: false, error: SLOT_TAKEN, refresh: true };

  // Read before moving: the move clears these.
  const was = formatSlot(invite.slotStart!, invite.slotEnd!, invite.recruiter.timezone);
  const oldGraphEventId = invite.graphEventId;
  const candidateTimezone = validTimezone(input.timezone) ? input.timezone : (invite.candidateTimezone ?? invite.recruiter.timezone);
  const moved = await moveSlot(invite.bookingId, invite.slotStart!, { slotStart: picked.startIso, slotEnd: picked.endIso, candidateTimezone });
  if (moved === "taken") return { ok: false, error: SLOT_TAKEN, refresh: true };
  if (moved !== "ok") return { ok: false, error: "This interview can't be moved now. Please refresh the page.", refresh: true };

  if (numbers.whatsapp !== invite.candidateWhatsapp || numbers.viber !== invite.candidateViber) {
    try {
      await saveCandidateNumbers(invite.bookingId, numbers);
    } catch (err) {
      console.error("[move] Saving WhatsApp/Viber numbers failed", invite.bookingId, err);
    }
  }

  const updated: InviteRecord = {
    ...invite,
    slotStart: picked.startIso,
    slotEnd: picked.endIso,
    candidateTimezone,
    candidateWhatsapp: numbers.whatsapp,
    candidateViber: numbers.viber,
    dailyRoomName: null,
    dailyRoomUrl: null,
    graphEventId: null,
  };
  after(() => afterBooking(updated, input.token, { was, oldGraphEventId }));

  revalidatePath(invitePath(invite, input.token));
  return { ok: true };
}

// Everything after a booking or, with `moved`, a candidate changing its time.
async function afterBooking(booked: InviteRecord, token: string, moved?: { was: string; oldGraphEventId: string | null }): Promise<void> {
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
          whatsapp: booked.candidateWhatsapp,
          viber: booked.candidateViber,
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
    if (moved?.oldGraphEventId) {
      await deleteInterviewEvent(recruiter.calendarEmail, moved.oldGraphEventId).catch((err) =>
        console.error("[book] Removing the old Outlook event failed", booked.bookingId, err),
      );
    }
  }

  // The recruiter's email, so they hear about it without watching the calendar.
  if (mailConfigured()) {
    try {
      const attendees = moved ? (await listGuests(booked.bookingId)).length : 0;
      const notice = recruiterBookingEmail({
        candidateName: booked.candidateName,
        candidateEmail: booked.candidateEmail,
        jobTitle: interview.jobTitle,
        clientName: interview.clientName,
        stage: stageLabel(interview.stage),
        when: recruiterWhen,
        candidateWhen: candidateZone === recruiter.timezone ? null : candidateWhen,
        whatsapp: booked.candidateWhatsapp,
        viber: booked.candidateViber,
        moved: moved ? { was: moved.was, attendees } : null,
        link: `${siteUrl()}/r/bookings/${booked.bookingId}`,
      });
      await sendCandidateMail({
        to: { name: recruiter.displayName, email: recruiter.calendarEmail },
        recruiter: { name: booked.candidateName, email: booked.candidateEmail },
        fromName: "COSInterview",
        subject: notice.subject,
        html: notice.bodyHtml,
        text: notice.text,
      });
    } catch (err) {
      console.error("[book] Recruiter notification failed", booked.bookingId, err);
    }
  }

  // 2. The candidate's confirmation, with the calendar file attached.
  const event = candidateCalendarEvent(booked, token)!;
  const bookingPage = `${siteUrl()}${invitePath(booked, token)}`;
  let emailNote: string | null = null;
  if (mailConfigured()) {
    try {
      const content = await bookingConfirmationEmail({
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
    await messageText("msgConfirmation", {
      ...candidateVars({ candidateName: booked.candidateName, jobTitle: interview.jobTitle, recruiterName: recruiter.displayName, recruiterTitle: recruiter.title }),
      when: candidateWhen,
      roomLink: event.url,
      bookingPage,
    }),
  );

  // 3. JobAdder: the time the candidate chose, and the confirmation they got.
  const summary = [
    `Interview ${moved ? "moved" : "booked"} by the candidate via COSInterview${interview.jobTitle ? ` for ${interview.jobTitle}` : ""}.`,
    ...(moved ? [`Was: ${moved.was}`] : []),
    `When: ${recruiterWhen}${candidateZone === recruiter.timezone ? "" : ` / candidate's time: ${candidateWhen}`}`,
    `Length: ${interview.durationMins} minutes. Recruiter: ${recruiter.displayName}.`,
  ].join("\n");
  await logToJobAdder(booked.jobadderCandidateId, [summary, emailNote, messageNote].filter(Boolean).join("\n\n"));

  // 4. The candidate overview for the recruiter (resume and notes against the
  // job description), also added to JobAdder. Last, as it takes a minute.
  if (!moved) await runCandidateReview(booked);
}

export type RoomAccess =
  | { ok: true; roomUrl: string | null; token: string | null; candidateName: string; bookingId: string }
  | { ok: false; reason: "invalid" | "not_booked" | "too_early" | "closed" | "unavailable" };

async function startedEarly(invite: InviteRecord): Promise<boolean> {
  if (!invite.dailyRoomName) return false;
  return recruiterStartedEarly(invite.dailyRoomName).catch((err) => {
    console.error("[room] Daily presence failed", invite.bookingId, err);
    return false;
  });
}

// Hands the candidate's page the room URL, only inside the join window or once
// the recruiter has chosen to start early. The candidate gets no meeting token, so
// Daily holds them in the lobby until the recruiter admits them, unless the
// recruiter started early: then they get one and go straight in. roomUrl is null
// in local dev without Daily credentials.
export async function getRoomAccess(recruiter: string, token: string): Promise<RoomAccess> {
  if (!allowRequest(await clientKey("room"), 30, 60_000)) return { ok: false, reason: "unavailable" };
  const invite = await loadInvite(recruiter, token);
  if (!invite) return { ok: false, reason: "invalid" };
  if (invite.status !== "booked" && invite.status !== "in_progress") return { ok: false, reason: "not_booked" };
  const window = joinWindow(invite);
  if (!window) return { ok: false, reason: "not_booked" };
  const now = DateTime.utc();
  if (now <= window.closes) await recordArrival(invite);
  const early = await startedEarly(invite);
  // The local demo skips the time check so the lobby can be tried straight away.
  if (!demoMode()) {
    if (now < window.opens && !early) return { ok: false, reason: "too_early" };
    if (now > window.closes) return { ok: false, reason: "closed" };
  }

  try {
    const room = await roomForBooking(invite);
    const token = room && early ? await createCandidateToken(room.name, invite.candidateName) : null;
    return { ok: true, roomUrl: room?.url ?? null, token, candidateName: invite.candidateName, bookingId: invite.bookingId };
  } catch (err) {
    console.error("[room] Daily room setup failed", invite.bookingId, err);
    return { ok: false, reason: "unavailable" };
  }
}
