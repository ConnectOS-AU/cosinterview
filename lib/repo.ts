import "server-only";
import { supabaseAdmin } from "./supabase/admin";
import { DEMO_BOOKING_ID, demoInvite, updateDemoInvite } from "./demo";
import type { BookingStatus, InviteRecord, TimeRange } from "./types";

// All database access for the candidate portal. Each function also handles the
// local demo invite, so pages and actions don't need to care which one they have.

const INVITE_SELECT = `
  id, status, candidate_name, candidate_email, candidate_timezone,
  slot_start, slot_end, invite_expires_at, daily_room_name, daily_room_url, graph_event_id,
  interview:cos_recruitment_interviews!inner (
    id, job_title, client_name, duration_mins, status,
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
  slot_start: string | null;
  slot_end: string | null;
  invite_expires_at: string | null;
  daily_room_name: string | null;
  daily_room_url: string | null;
  graph_event_id: string | null;
  interview: {
    id: string;
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
    slotStart: row.slot_start,
    slotEnd: row.slot_end,
    inviteExpiresAt: row.invite_expires_at,
    dailyRoomName: row.daily_room_name,
    dailyRoomUrl: row.daily_room_url,
    graphEventId: row.graph_event_id,
    interview: {
      id: interview.id,
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
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .select(INVITE_SELECT)
    .eq("invite_token_hash", hash)
    .maybeSingle();
  if (error) throw new Error(`Invite lookup failed: ${error.message}`);
  return data ? toRecord(data as unknown as Row) : null;
}

// The recruiter's interviews already booked through this portal, overlapping
// [from, to). Combined with their Outlook free/busy to work out open slots.
export async function listRecruiterBookings(recruiterId: string, from: string, to: string): Promise<TimeRange[]> {
  if (recruiterId === demoInvite().recruiter.id) {
    const demo = demoInvite();
    return demo.slotStart && demo.slotEnd ? [{ start: demo.slotStart, end: demo.slotEnd }] : [];
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

// Moves an invite to booked. Only succeeds while it is still 'invited', so a
// double submit (or two tabs) can't book twice.
export async function claimSlot(
  bookingId: string,
  fields: { slotStart: string; slotEnd: string; candidateTimezone: string; consentAt: string },
): Promise<boolean> {
  if (bookingId === DEMO_BOOKING_ID) {
    if (demoInvite().status !== "invited") return false;
    updateDemoInvite({
      status: "booked",
      slotStart: fields.slotStart,
      slotEnd: fields.slotEnd,
      candidateTimezone: fields.candidateTimezone,
    });
    return true;
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .update({
      status: "booked",
      slot_start: fields.slotStart,
      slot_end: fields.slotEnd,
      candidate_timezone: fields.candidateTimezone,
      recording_consent_at: fields.consentAt,
    })
    .eq("id", bookingId)
    .eq("status", "invited")
    .select("id");
  if (error) throw new Error(`Booking update failed: ${error.message}`);
  return (data ?? []).length === 1;
}

export async function saveRoom(bookingId: string, room: { name: string; url: string }): Promise<void> {
  if (bookingId === DEMO_BOOKING_ID) {
    updateDemoInvite({ dailyRoomName: room.name, dailyRoomUrl: room.url });
    return;
  }
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .update({ daily_room_name: room.name, daily_room_url: room.url })
    .eq("id", bookingId);
  if (error) throw new Error(`Saving room failed: ${error.message}`);
}

export async function saveGraphEvent(bookingId: string, eventId: string): Promise<void> {
  if (bookingId === DEMO_BOOKING_ID) {
    updateDemoInvite({ graphEventId: eventId });
    return;
  }
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .update({ graph_event_id: eventId })
    .eq("id", bookingId);
  if (error) throw new Error(`Saving calendar event failed: ${error.message}`);
}
