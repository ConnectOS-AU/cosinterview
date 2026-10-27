import "server-only";
import { DateTime } from "luxon";
import { demoId, demoInviteById, demoInvites, demoMode, demoStore, inviteFor, updateDemoInvite } from "../demo";
import { supabaseAdmin } from "../supabase/admin";
import type {
  BookingStatus,
  BookingSummary,
  InterviewNote,
  InterviewRound,
  NewInvite,
  RecruiterProfile,
} from "../types";

// Database access for the recruiter screens. Each function serves the local
// demo store too when Supabase isn't configured, like lib/repo.ts.

export type { BookingSummary, InterviewNote, RecruiterProfile };

const RECRUITER_COLUMNS = "id, user_id, slug, display_name, title, photo_path, bio, welcome_message, timezone, calendar_email, active";

type RecruiterRow = {
  id: string;
  user_id: string | null;
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

function toRecruiter(row: RecruiterRow): RecruiterProfile {
  return {
    id: row.id,
    userId: row.user_id,
    slug: row.slug,
    displayName: row.display_name,
    title: row.title,
    photoPath: row.photo_path,
    bio: row.bio,
    welcomeMessage: row.welcome_message,
    timezone: row.timezone,
    calendarEmail: row.calendar_email,
    active: row.active,
  };
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

// COSHub's rule: only people SCIM has provisioned (assigned to COSHub in Entra)
// and still active. Matches userName (the UPN) or any listed email.
export async function isActiveStaff(email: string): Promise<boolean> {
  const value = email.trim().toLowerCase();
  const db = supabaseAdmin();
  const byUserName = await db.from("coshub_scim_users").select("active").ilike("user_name", escapeLike(value)).limit(1);
  if (byUserName.error) throw new Error(`Staff lookup failed: ${byUserName.error.message}`);
  if (byUserName.data?.[0]) return Boolean(byUserName.data[0].active);
  const byEmail = await db.from("coshub_scim_users").select("active").contains("emails", [{ value }]).limit(1);
  if (byEmail.error) throw new Error(`Staff lookup failed: ${byEmail.error.message}`);
  return Boolean(byEmail.data?.[0]?.active);
}

export async function findRecruiterByEmail(email: string): Promise<RecruiterProfile | null> {
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_recruiters")
    .select(RECRUITER_COLUMNS)
    .ilike("calendar_email", escapeLike(email))
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`Recruiter lookup failed: ${error.message}`);
  return data ? toRecruiter(data as RecruiterRow) : null;
}

export function demoRecruiter(): RecruiterProfile {
  return { ...demoStore().recruiter };
}

export type ProfileFields = Pick<RecruiterProfile, "displayName" | "title" | "bio" | "welcomeMessage" | "timezone"> & {
  photoPath?: string | null;
};

export async function updateRecruiterProfile(recruiterId: string, fields: ProfileFields): Promise<void> {
  if (demoMode()) {
    Object.assign(demoStore().recruiter, fields);
    return;
  }
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_recruiters")
    .update({
      display_name: fields.displayName,
      title: fields.title,
      bio: fields.bio,
      welcome_message: fields.welcomeMessage,
      timezone: fields.timezone,
      ...(fields.photoPath !== undefined ? { photo_path: fields.photoPath } : {}),
    })
    .eq("id", recruiterId);
  if (error) throw new Error(`Saving profile failed: ${error.message}`);
}

// --- Bookings ----------------------------------------------------------------

export async function listBookingsForRecruiter(recruiterId: string): Promise<BookingSummary[]> {
  if (demoMode()) {
    return demoInvites()
      .filter((i) => i.recruiter.id === recruiterId)
      .map((d) => ({
        bookingId: d.bookingId,
        interviewId: d.interview.id,
        status: d.status,
        candidateName: d.candidateName,
        candidateEmail: d.candidateEmail,
        jobTitle: d.interview.jobTitle,
        clientName: d.interview.clientName,
        slotStart: d.slotStart,
        slotEnd: d.slotEnd,
        inviteExpiresAt: d.inviteExpiresAt,
      }))
      .sort((a, b) => (a.slotStart ?? "~").localeCompare(b.slotStart ?? "~"));
  }
  // Anything created in the last 30 days, plus anything still to happen.
  const since = DateTime.utc().minus({ days: 30 }).toISO()!;
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .select(
      "id, interview_id, status, candidate_name, candidate_email, slot_start, slot_end, invite_expires_at, interview:cos_recruitment_interviews!inner(recruiter_id, job_title, client_name)",
    )
    .eq("interview.recruiter_id", recruiterId)
    .or(`created_at.gte.${since},slot_start.gte.${since}`)
    .order("slot_start", { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) throw new Error(`Booking list failed: ${error.message}`);
  return (data ?? []).map((row) => {
    const interview = row.interview as unknown as { job_title: string | null; client_name: string | null };
    return {
      bookingId: row.id,
      interviewId: row.interview_id,
      status: row.status as BookingStatus,
      candidateName: row.candidate_name,
      candidateEmail: row.candidate_email,
      jobTitle: interview.job_title,
      clientName: interview.client_name,
      slotStart: row.slot_start,
      slotEnd: row.slot_end,
      inviteExpiresAt: row.invite_expires_at,
    };
  });
}

export async function setBookingStatus(bookingId: string, status: BookingStatus): Promise<void> {
  if (demoMode()) return updateDemoInvite(bookingId, { status });
  const { error } = await supabaseAdmin().from("cos_recruitment_bookings").update({ status }).eq("id", bookingId);
  if (error) throw new Error(`Status update failed: ${error.message}`);
}

// One row per Daily recording; the transcription worker picks it up once Daily
// says the raw tracks are ready (app/api/daily/webhook).
export async function recordRecordingStarted(bookingId: string, dailyRecordingId: string): Promise<void> {
  if (demoMode()) return;
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_recordings")
    .upsert(
      { booking_id: bookingId, daily_recording_id: dailyRecordingId, started_at: new Date().toISOString() },
      { onConflict: "daily_recording_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Saving recording failed: ${error.message}`);
}

// --- Interviews and invites ---------------------------------------------------

// One open interview per recruiter, job and length: inviting more candidates
// to the same job later adds them to the same interview.
export async function openInterviewFor(
  recruiter: RecruiterProfile,
  job: { jobId: string; title: string; companyName: string | null },
  durationMins: number,
  createdBy: string,
): Promise<InterviewRound> {
  if (demoMode()) {
    const store = demoStore();
    const existing = store.interviews.find(
      (i) => i.recruiterId === recruiter.id && i.jobadderJobId === job.jobId && i.durationMins === durationMins && i.status === "open",
    );
    if (existing) return existing;
    const created: InterviewRound = {
      id: demoId("interview"),
      recruiterId: recruiter.id,
      jobadderJobId: job.jobId,
      jobTitle: job.title,
      clientName: job.companyName,
      durationMins,
      status: "open",
      createdAt: new Date().toISOString(),
    };
    store.interviews.push(created);
    return created;
  }
  const db = supabaseAdmin();
  const columns = "id, recruiter_id, jobadder_job_id, job_title, client_name, duration_mins, status, created_at";
  const found = await db
    .from("cos_recruitment_interviews")
    .select(columns)
    .eq("recruiter_id", recruiter.id)
    .eq("jobadder_job_id", job.jobId)
    .eq("duration_mins", durationMins)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (found.error) throw new Error(`Interview lookup failed: ${found.error.message}`);
  const row =
    found.data ??
    (
      await db
        .from("cos_recruitment_interviews")
        .insert({
          recruiter_id: recruiter.id,
          jobadder_job_id: job.jobId,
          job_title: job.title,
          client_name: job.companyName,
          duration_mins: durationMins,
          created_by: createdBy,
        })
        .select(columns)
        .single()
    ).data;
  if (!row) throw new Error("Creating the interview failed.");
  return {
    id: row.id,
    recruiterId: row.recruiter_id,
    jobadderJobId: row.jobadder_job_id,
    jobTitle: row.job_title,
    clientName: row.client_name,
    durationMins: row.duration_mins,
    status: row.status,
    createdAt: row.created_at,
  };
}

// The recruiter's existing invites for a JobAdder job, by JobAdder candidate
// id, so the picker can show who's already been invited (cancelled ones can be
// invited again).
export async function invitesForJob(recruiterId: string, jobId: string): Promise<Map<string, BookingStatus>> {
  if (demoMode()) {
    return new Map(
      demoInvites()
        .filter((i) => i.recruiter.id === recruiterId && i.interview.jobadderJobId === jobId && i.status !== "cancelled")
        .map((i) => [i.jobadderCandidateId, i.status]),
    );
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .select("jobadder_candidate_id, status, interview:cos_recruitment_interviews!inner(recruiter_id, jobadder_job_id)")
    .eq("interview.recruiter_id", recruiterId)
    .eq("interview.jobadder_job_id", jobId)
    .neq("status", "cancelled");
  if (error) throw new Error(`Invite lookup failed: ${error.message}`);
  return new Map((data ?? []).map((r) => [r.jobadder_candidate_id as string, r.status as BookingStatus]));
}

// Creates one booking per candidate in 'invited'. Returns the new booking ids by
// JobAdder candidate id. Duplicates are skipped by the unique constraint.
export async function createInvites(
  recruiter: RecruiterProfile,
  interview: InterviewRound,
  invites: NewInvite[],
): Promise<Map<string, string>> {
  const created = new Map<string, string>();
  if (invites.length === 0) return created;
  if (demoMode()) {
    const store = demoStore();
    for (const c of invites) {
      const bookingId = demoId("booking");
      store.invites.push({
        ...inviteFor(recruiter, interview, { bookingId, ...c }),
        tokenHash: c.tokenHash,
      });
      created.set(c.candidateId, bookingId);
    }
    return created;
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .upsert(
      invites.map((c) => ({
        interview_id: interview.id,
        jobadder_candidate_id: c.candidateId,
        jobadder_application_id: c.applicationId,
        candidate_name: c.name,
        candidate_email: c.email,
        invite_token_hash: c.tokenHash,
        invite_expires_at: c.expiresAt,
      })),
      { onConflict: "interview_id,jobadder_candidate_id", ignoreDuplicates: true },
    )
    .select("id, jobadder_candidate_id");
  if (error) throw new Error(`Creating invites failed: ${error.message}`);
  for (const row of data ?? []) created.set(row.jobadder_candidate_id, row.id);

  // Someone whose earlier booking for this interview was cancelled is invited
  // again on the same row (one row per candidate per interview).
  for (const c of invites.filter((i) => !created.has(i.candidateId))) {
    const reopened = await supabaseAdmin()
      .from("cos_recruitment_bookings")
      .update({
        status: "invited",
        candidate_name: c.name,
        candidate_email: c.email,
        invite_token_hash: c.tokenHash,
        invite_expires_at: c.expiresAt,
        recording_consent_at: null,
      })
      .eq("interview_id", interview.id)
      .eq("jobadder_candidate_id", c.candidateId)
      .eq("status", "cancelled")
      .select("id")
      .maybeSingle();
    if (reopened.error) throw new Error(`Re-inviting failed: ${reopened.error.message}`);
    if (reopened.data) created.set(c.candidateId, reopened.data.id);
  }
  return created;
}

// A fresh link for an invite that hasn't been booked (lost email, expired).
// The old link stops working because only the new hash is stored.
export async function replaceInviteToken(bookingId: string, tokenHash: string, expiresAt: string): Promise<void> {
  if (demoMode()) {
    const invite = demoInviteById(bookingId);
    if (invite) Object.assign(invite, { tokenHash, inviteExpiresAt: expiresAt });
    return;
  }
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .update({ invite_token_hash: tokenHash, invite_expires_at: expiresAt })
    .eq("id", bookingId)
    .eq("status", "invited");
  if (error) throw new Error(`Updating invite failed: ${error.message}`);
}

// --- Notes -----------------------------------------------------------------

export async function listNotes(bookingId: string): Promise<InterviewNote[]> {
  if (demoMode()) return [...(demoStore().notes.get(bookingId) ?? [])];
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
  if (demoMode()) {
    const notes = demoStore().notes;
    const created = { id: demoId("note"), body: note.body, offsetMs: note.offsetMs, createdAt: new Date().toISOString() };
    notes.set(bookingId, [...(notes.get(bookingId) ?? []), created]);
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
  if (demoMode()) {
    const notes = demoStore().notes;
    notes.set(bookingId, (notes.get(bookingId) ?? []).filter((n) => n.id !== noteId));
    return;
  }
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_interview_notes")
    .delete()
    .eq("id", Number(noteId))
    .eq("booking_id", bookingId);
  if (error) throw new Error(`Deleting note failed: ${error.message}`);
}
