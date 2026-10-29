import "server-only";
import { DateTime } from "luxon";
import { bookingWindow, freeSlots } from "./availability";
import type { CalendarEvent } from "./calendar";
import { DEMO_BOOKING_ID, demoInviteById, isDemoInvite } from "./demo";
import { getBusy, graphConfigured } from "./graph";
import { findInviteByTokenHash, listRecruiterBookings } from "./repo";
import { hashToken, looksLikeToken } from "./tokens";
import type { InviteRecord, PublicRecruiter } from "./types";

// Public Supabase Storage bucket that holds recruiter photos.
export const RECRUITER_PHOTO_BUCKET = "recruitment-public";

// The room opens this long before the start, and stays joinable this long after the end.
export const JOIN_OPENS_MINS = 15;
export const JOIN_CLOSES_MINS = 60;

export async function loadInvite(slug: string, token: string): Promise<InviteRecord | null> {
  if (isDemoInvite(slug, token)) return demoInviteById(DEMO_BOOKING_ID);
  if (!looksLikeToken(token)) return null;
  const invite = await findInviteByTokenHash(hashToken(token));
  if (!invite || invite.recruiter.slug !== slug || !invite.recruiter.active) return null;
  return invite;
}

export function inviteExpired(invite: InviteRecord, now = DateTime.utc()): boolean {
  return Boolean(invite.inviteExpiresAt && DateTime.fromISO(invite.inviteExpiresAt) < now);
}

export function joinWindow(invite: InviteRecord): { opens: DateTime; closes: DateTime } | null {
  if (!invite.slotStart || !invite.slotEnd) return null;
  return {
    opens: DateTime.fromISO(invite.slotStart).minus({ minutes: JOIN_OPENS_MINS }),
    closes: DateTime.fromISO(invite.slotEnd).plus({ minutes: JOIN_CLOSES_MINS }),
  };
}

export function recruiterPhotoUrl(photoPath: string | null): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return photoPath && base ? `${base}/storage/v1/object/public/${RECRUITER_PHOTO_BUCKET}/${photoPath}` : null;
}

export function publicRecruiter(invite: InviteRecord): PublicRecruiter {
  const { recruiter } = invite;
  return {
    displayName: recruiter.displayName,
    firstName: recruiter.displayName.split(" ")[0],
    title: recruiter.title,
    photoUrl: recruiterPhotoUrl(recruiter.photoPath),
    bio: recruiter.bio,
    welcomeMessage: recruiter.welcomeMessage,
  };
}

// Open slots for this invite: the recruiter's Outlook free/busy plus anything
// already booked through the portal. Without Graph credentials (local dev only)
// the calendar is treated as empty.
export async function availableSlots(invite: InviteRecord): Promise<string[]> {
  const { from, to } = bookingWindow();
  const busy = await listRecruiterBookings(invite.recruiter.id, from.toISO()!, to.toISO()!);
  if (graphConfigured()) {
    busy.push(...(await getBusy(invite.recruiter.calendarEmail, from, to)));
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("Microsoft Graph is not configured; cannot read recruiter availability.");
  }
  return freeSlots({
    timezone: invite.recruiter.timezone,
    durationMins: invite.interview.durationMins,
    busy,
  });
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3008").replace(/\/$/, "");
}

export function invitePath(invite: InviteRecord, token: string): string {
  return `/c/${invite.recruiter.slug}/${token}`;
}

// The candidate's calendar entry for a booked interview, pointing at their room.
export function candidateCalendarEvent(invite: InviteRecord, token: string): CalendarEvent | null {
  if (!invite.slotStart || !invite.slotEnd) return null;
  const roomLink = `${siteUrl()}${invitePath(invite, token)}/room`;
  return {
    uid: `${invite.bookingId}@interviews.connectos.co`,
    title: `ConnectOS interview with ${invite.recruiter.displayName}`,
    description: `Join your video interview here: ${roomLink}\nThe room opens 15 minutes before the start time.`,
    start: invite.slotStart,
    end: invite.slotEnd,
    url: roomLink,
  };
}
