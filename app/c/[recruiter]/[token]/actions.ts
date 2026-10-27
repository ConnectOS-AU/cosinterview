"use server";

import { DateTime } from "luxon";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { dailyConfigured, ensureInterviewRoom } from "@/lib/daily";
import { DEMO_BOOKING_ID } from "@/lib/demo";
import { createInterviewEvent, graphConfigured } from "@/lib/graph";
import {
  availableSlots,
  invitePath,
  inviteExpired,
  joinWindow,
  loadInvite,
  siteUrl,
} from "@/lib/invite";
import { allowRequest } from "@/lib/rate-limit";
import { claimSlot, saveGraphEvent, saveRoom } from "@/lib/repo";
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
  if (!claimed) return { ok: false, error: "This interview is already booked.", refresh: true };

  // The booking is saved. Room and calendar entry are best-effort here: the room
  // is created again on join if this fails, and a missing calendar entry is
  // logged for follow-up rather than undoing the candidate's booking.
  const booked = { ...invite, slotStart: startIso, slotEnd: endIso };
  try {
    await setUpRoom(booked);
  } catch (err) {
    console.error("[book] Daily room setup failed", invite.bookingId, err);
  }
  if (graphConfigured()) {
    try {
      const roomLink = `${siteUrl()}${invitePath(invite, input.token)}/room`;
      const eventId = await createInterviewEvent(invite.recruiter.calendarEmail, {
        subject: `Interview: ${invite.candidateName}${invite.interview.jobTitle ? ` – ${invite.interview.jobTitle}` : ""}`,
        bodyHtml:
          `<p>Your ConnectOS video interview with ${invite.recruiter.displayName}.</p>` +
          `<p><a href="${roomLink}">Join the interview</a> (opens 15 minutes before the start time).</p>`,
        start: startIso,
        end: endIso,
        joinUrl: roomLink,
        candidate: { name: invite.candidateName, email: invite.candidateEmail },
      });
      await saveGraphEvent(invite.bookingId, eventId);
    } catch (err) {
      console.error("[book] Outlook event creation failed", invite.bookingId, err);
    }
  }

  revalidatePath(invitePath(invite, input.token));
  return { ok: true };
}

async function setUpRoom(invite: InviteRecord): Promise<{ url: string } | null> {
  if (invite.dailyRoomUrl) return { url: invite.dailyRoomUrl };
  if (!dailyConfigured() || !invite.slotStart || !invite.slotEnd) return null;
  const room = await ensureInterviewRoom(`cosrec-${invite.bookingId}`, {
    start: invite.slotStart,
    end: invite.slotEnd,
  });
  await saveRoom(invite.bookingId, room);
  return { url: room.url };
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
  if (invite.bookingId !== DEMO_BOOKING_ID) {
    if (now < window.opens) return { ok: false, reason: "too_early" };
    if (now > window.closes) return { ok: false, reason: "closed" };
  }

  try {
    const room = await setUpRoom(invite);
    return { ok: true, roomUrl: room?.url ?? null, candidateName: invite.candidateName, bookingId: invite.bookingId };
  } catch (err) {
    console.error("[room] Daily room setup failed", invite.bookingId, err);
    return { ok: false, reason: "unavailable" };
  }
}
