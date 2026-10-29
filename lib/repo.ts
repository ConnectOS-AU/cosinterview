import "server-only";
import { demoInviteById, demoInvites, demoMode, updateDemoInvite } from "./demo";
import { supabaseAdmin } from "./supabase/admin";
import type { BookingStatus, InviteRecord, TimeRange } from "./types";

// Booking/invite access shared by the candidate portal and the recruiter
// screens. Each function also serves the local demo store (lib/demo.ts) when
// Supabase isn't configured, so pages and actions don't need to care.

const INVITE_SELECT = `
  id, status, candidate_name, candidate_email, candidate_timezone,
  jobadder_candidate_id, jobadder_application_id,
  slot_start, slot_end, invite_expires_at, daily_room_name, daily_room_url, graph_event_id,
  interview:cos_recruitment_interviews!inner (
    id, jobadder_job_id, job_title, client_name, duration_mins, status,
    recruiter:cos_recruitment_recruiters!inner (
      id, slug, display_name, title, photo_path, bio, welcome_message, timezone, calendar_email, active
    )
  )
`;

type Row = {
  id: string;
  status: BookingStatus;
  candidate_name: string;
  candidate_email: string;
  candidate_timezone: string | null;
  jobadder_candidate_id: string;
  jobadder_application_id: string | null;
  slot_start: string | null;
  slot_end: string | null;
  invite_expires_at: string | null;
  daily_room_name: string | null;
  daily_room_url: string | null;
  graph_event_id: string | null;
  interview: {
    id: string;
    jobadder_job_id: string;
    job_title: string | null;
    client_name: string | null;
    duration_mins: number;
    status: "open" | "closed";
    recruiter: {
      id: string;
      slug: string;
      display_name: string;
      title: string | null;
      photo_path: string | null;
      bio: string | null;
      welcome_message: string | null;
      timezone: string;
      calendar_email: string;
      active: boolean;
    };
  };
};

function toRecord(row: Row): InviteRecord {
  const { interview } = row;
  const { recruiter } = interview;
  return {
    bookingId: row.id,
    status: row.status,
    candidateName: row.candidate_name,
    candidateEmail: row.candidate_email,
    candidateTimezone: row.candidate_timezone,
    jobadderCandidateId: row.jobadder_candidate_id,
    jobadderApplicationId: row.jobadder_application_id,
    slotStart: row.slot_start,
    slotEnd: row.slot_end,
    inviteExpiresAt: row.invite_expires_at,
    dailyRoomName: row.daily_room_name,
    dailyRoomUrl: row.daily_room_url,
    graphEventId: row.graph_event_id,
    interview: {
      id: interview.id,
      jobadderJobId: interview.jobadder_job_id,
      jobTitle: interview.job_title,
      clientName: interview.client_name,
      durationMins: interview.duration_mins,
      status: interview.status,
    },
    recruiter: {
      id: recruiter.id,
      slug: recruiter.slug,
      displayName: recruiter.display_name,
      title: recruiter.title,
      photoPath: recruiter.photo_path,
      bio: recruiter.bio,
      welcomeMessage: recruiter.welcome_message,
      timezone: recruiter.timezone,
      calendarEmail: recruiter.calendar_email,
      active: recruiter.active,
    },
  };
}

export async function findInviteByTokenHash(hash: string): Promise<InviteRecord | null> {
  if (demoMode()) return demoInvites().find((i) => i.tokenHash === hash) ?? null;
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .select(INVITE_SELECT)
    .eq("invite_token_hash", hash)
    .maybeSingle();
  if (error) throw new Error(`Invite lookup failed: ${error.message}`);
  return data ? toRecord(data as unknown as Row) : null;
}

export async function findInviteById(bookingId: string): Promise<InviteRecord | null> {
  if (demoMode()) return demoInviteById(bookingId);
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return null;
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .select(INVITE_SELECT)
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new Error(`Booking lookup failed: ${error.message}`);
  return data ? toRecord(data as unknown as Row) : null;
}

// The recruiter's interviews already booked through this portal, overlapping
// [from, to). Combined with their Outlook free/busy to work out open slots.
export async function listRecruiterBookings(recruiterId: string, from: string, to: string): Promise<TimeRange[]> {
  if (demoMode()) {
    return demoInvites()
      .filter((i) => i.recruiter.id === recruiterId && (i.status === "booked" || i.status === "in_progress"))
      .filter((i) => i.slotStart && i.slotEnd && i.slotStart < to && i.slotEnd > from)
      .map((i) => ({ start: i.slotStart!, end: i.slotEnd! }));
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .select("slot_start, slot_end, interview:cos_recruitment_interviews!inner(recruiter_id)")
    .eq("interview.recruiter_id", recruiterId)
    .in("status", ["booked", "in_progress"])
    .lt("slot_start", to)
    .gt("slot_end", from);
  if (error) throw new Error(`Booking lookup failed: ${error.message}`);
  return (data ?? []).map((b) => ({ start: b.slot_start as string, end: b.slot_end as string }));
}

export type ClaimResult = "ok" | "taken" | "not_invited";

// Moves an invite to booked. The database function locks the recruiter, then
// refuses if the invite is no longer 'invited' (double submit, two tabs) or the
// time overlaps another of the recruiter's bookings (two candidates at once).
export async function claimSlot(
  bookingId: string,
  fields: { slotStart: string; slotEnd: string; candidateTimezone: string; consentAt: string },
): Promise<ClaimResult> {
  if (demoMode()) {
    const invite = demoInviteById(bookingId);
    if (!invite || invite.status !== "invited") return "not_invited";
    const clash = demoInvites().some(
      (i) =>
        i.bookingId !== bookingId &&
        i.recruiter.id === invite.recruiter.id &&
        (i.status === "booked" || i.status === "in_progress") &&
        i.slotStart! < fields.slotEnd &&
        i.slotEnd! > fields.slotStart,
    );
    if (clash) return "taken";
    updateDemoInvite(bookingId, {
      status: "booked",
      slotStart: fields.slotStart,
      slotEnd: fields.slotEnd,
      candidateTimezone: fields.candidateTimezone,
    });
    return "ok";
  }
  const { data, error } = await supabaseAdmin().rpc("cos_recruitment_claim_slot", {
    p_booking_id: bookingId,
    p_slot_start: fields.slotStart,
    p_slot_end: fields.slotEnd,
    p_candidate_timezone: fields.candidateTimezone,
    p_consent_at: fields.consentAt,
  });
  if (error) throw new Error(`Booking update failed: ${error.message}`);
  return data as ClaimResult;
}

export async function saveRoom(bookingId: string, room: { name: string; url: string }): Promise<void> {
  if (demoMode()) return updateDemoInvite(bookingId, { dailyRoomName: room.name, dailyRoomUrl: room.url });
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .update({ daily_room_name: room.name, daily_room_url: room.url })
    .eq("id", bookingId);
  if (error) throw new Error(`Saving room failed: ${error.message}`);
}

export async function saveGraphEvent(bookingId: string, eventId: string | null): Promise<void> {
  if (demoMode()) return updateDemoInvite(bookingId, { graphEventId: eventId });
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .update({ graph_event_id: eventId })
    .eq("id", bookingId);
  if (error) throw new Error(`Saving calendar event failed: ${error.message}`);
}

// Cancel (by either side) or put back to 'invited' with a fresh link so the
// candidate can pick a new time. Clears the slot, room and calendar entry ids.
export async function releaseBooking(
  bookingId: string,
  next: { status: "cancelled" } | { status: "invited"; tokenHash: string; expiresAt: string },
): Promise<void> {
  const cleared = { slotStart: null, slotEnd: null, dailyRoomName: null, dailyRoomUrl: null, graphEventId: null };
  if (demoMode()) {
    const invite = demoInviteById(bookingId);
    if (!invite) return;
    Object.assign(invite, cleared, { status: next.status });
    if (next.status === "invited") Object.assign(invite, { tokenHash: next.tokenHash, inviteExpiresAt: next.expiresAt });
    return;
  }
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .update({
      status: next.status,
      slot_start: null,
      slot_end: null,
      daily_room_name: null,
      daily_room_url: null,
      graph_event_id: null,
      ...(next.status === "invited"
        ? { invite_token_hash: next.tokenHash, invite_expires_at: next.expiresAt, recording_consent_at: null }
        : {}),
    })
    .eq("id", bookingId);
  if (error) throw new Error(`Updating booking failed: ${error.message}`);
}
