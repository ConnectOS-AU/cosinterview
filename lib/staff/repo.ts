import "server-only";
import { DateTime } from "luxon";
import { DEMO_BOOKING_ID, demoInvite, updateDemoInvite } from "../demo";
import { supabaseAdmin } from "../supabase/admin";
import type { BookingStatus } from "../types";

// Database access for the recruiter screens. Each function handles the local
// demo recruiter/booking too, like lib/repo.ts does for the candidate portal.

export const DEMO_RECRUITER_ID = "demo-recruiter";

export type RecruiterProfile = {
  id: string;
  displayName: string;
  title: string | null;
  timezone: string;
  calendarEmail: string;
};

export type BookingSummary = {
  bookingId: string;
  status: BookingStatus;
  candidateName: string;
  jobTitle: string | null;
  clientName: string | null;
  slotStart: string | null;
  slotEnd: string | null;
};

export type InterviewNote = {
  id: string;
  body: string;
  offsetMs: number | null;
  createdAt: string;
};

// COSHub's rule: only people SCIM has provisioned (assigned to COSHub in Entra)
// and still active. Matches userName (the UPN) or any listed email.
export async function isActiveStaff(email: string): Promise<boolean> {
  const value = email.trim().toLowerCase();
  const db = supabaseAdmin();
  const byUserName = await db
    .from("coshub_scim_users")
    .select("active")
    .ilike("user_name", value.replace(/[\\%_]/g, "\\$&"))
    .limit(1);
  if (byUserName.error) throw new Error(`Staff lookup failed: ${byUserName.error.message}`);
  if (byUserName.data?.[0]) return Boolean(byUserName.data[0].active);
  const byEmail = await db.from("coshub_scim_users").select("active").contains("emails", [{ value }]).limit(1);
  if (byEmail.error) throw new Error(`Staff lookup failed: ${byEmail.error.message}`);
  return Boolean(byEmail.data?.[0]?.active);
}

export async function findRecruiterByEmail(email: string): Promise<RecruiterProfile | null> {
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_recruiters")
    .select("id, display_name, title, timezone, calendar_email")
    .ilike("calendar_email", email.replace(/[\\%_]/g, "\\$&"))
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`Recruiter lookup failed: ${error.message}`);
  return data
    ? {
        id: data.id,
        displayName: data.display_name,
        title: data.title,
        timezone: data.timezone,
        calendarEmail: data.calendar_email,
      }
    : null;
}

export function demoRecruiter(): RecruiterProfile {
  const { recruiter } = demoInvite();
  return {
    id: DEMO_RECRUITER_ID,
    displayName: recruiter.displayName,
    title: recruiter.title,
    timezone: recruiter.timezone,
    calendarEmail: recruiter.calendarEmail,
  };
}

export async function listBookingsForRecruiter(recruiterId: string): Promise<BookingSummary[]> {
  if (recruiterId === DEMO_RECRUITER_ID) {
    const d = demoInvite();
    return [
      {
        bookingId: d.bookingId,
        status: d.status,
        candidateName: d.candidateName,
        jobTitle: d.interview.jobTitle,
        clientName: d.interview.clientName,
        slotStart: d.slotStart,
        slotEnd: d.slotEnd,
      },
    ];
  }
  const since = DateTime.utc().minus({ days: 30 }).toISO()!;
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .select(
      "id, status, candidate_name, slot_start, slot_end, created_at, interview:cos_recruitment_interviews!inner(recruiter_id, job_title, client_name)",
    )
    .eq("interview.recruiter_id", recruiterId)
    .gte("created_at", since)
    .order("slot_start", { ascending: true, nullsFirst: false })
    .limit(200);
  if (error) throw new Error(`Booking list failed: ${error.message}`);
  return (data ?? []).map((row) => {
    const interview = row.interview as unknown as { job_title: string | null; client_name: string | null };
    return {
      bookingId: row.id,
      status: row.status as BookingStatus,
      candidateName: row.candidate_name,
      jobTitle: interview.job_title,
      clientName: interview.client_name,
      slotStart: row.slot_start,
      slotEnd: row.slot_end,
    };
  });
}

export async function setBookingStatus(bookingId: string, status: BookingStatus): Promise<void> {
  if (bookingId === DEMO_BOOKING_ID) {
    updateDemoInvite({ status });
    return;
  }
  const { error } = await supabaseAdmin().from("cos_recruitment_bookings").update({ status }).eq("id", bookingId);
  if (error) throw new Error(`Status update failed: ${error.message}`);
}

// One row per Daily recording; the transcription worker picks up 'pending' rows
// once Daily says the raw tracks are ready.
export async function recordRecordingStarted(bookingId: string, dailyRecordingId: string): Promise<void> {
  if (bookingId === DEMO_BOOKING_ID) return;
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_recordings")
    .upsert(
      { booking_id: bookingId, daily_recording_id: dailyRecordingId, started_at: new Date().toISOString() },
      { onConflict: "daily_recording_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Saving recording failed: ${error.message}`);
}

// --- Notes -----------------------------------------------------------------

type DemoNotes = { notes: InterviewNote[]; next: number };
const store = globalThis as typeof globalThis & { __cosrecDemoNotes?: DemoNotes };
function demoNotes(): DemoNotes {
  return (store.__cosrecDemoNotes ??= { notes: [], next: 1 });
}

export async function listNotes(bookingId: string): Promise<InterviewNote[]> {
  if (bookingId === DEMO_BOOKING_ID) return [...demoNotes().notes];
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_interview_notes")
    .select("id, body, offset_ms, created_at")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Loading notes failed: ${error.message}`);
  return (data ?? []).map((n) => ({ id: String(n.id), body: n.body, offsetMs: n.offset_ms, createdAt: n.created_at }));
}

export async function addNote(
  bookingId: string,
  authorId: string,
  note: { body: string; offsetMs: number | null },
): Promise<InterviewNote> {
  if (bookingId === DEMO_BOOKING_ID) {
    const demo = demoNotes();
    const created = { id: String(demo.next++), body: note.body, offsetMs: note.offsetMs, createdAt: new Date().toISOString() };
    demo.notes.push(created);
    return created;
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_interview_notes")
    .insert({ booking_id: bookingId, author_id: authorId, body: note.body, offset_ms: note.offsetMs })
    .select("id, body, offset_ms, created_at")
    .single();
  if (error) throw new Error(`Saving note failed: ${error.message}`);
  return { id: String(data.id), body: data.body, offsetMs: data.offset_ms, createdAt: data.created_at };
}

export async function deleteNote(bookingId: string, noteId: string): Promise<void> {
  if (bookingId === DEMO_BOOKING_ID) {
    const demo = demoNotes();
    demo.notes = demo.notes.filter((n) => n.id !== noteId);
    return;
  }
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_interview_notes")
    .delete()
    .eq("id", Number(noteId))
    .eq("booking_id", bookingId);
  if (error) throw new Error(`Deleting note failed: ${error.message}`);
}
