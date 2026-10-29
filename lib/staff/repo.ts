import "server-only";
import { DateTime } from "luxon";
import { demoId, demoInviteById, demoInvites, demoMode, demoRecruiters, demoStore, inviteFor, updateDemoInvite } from "../demo";
import type { Stage } from "../stages";
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

const RECRUITER_COLUMNS = "id, user_id, slug, display_name, title, photo_path, bio, welcome_message, timezone, calendar_email, active, is_admin";

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
  is_admin: boolean;
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
    isAdmin: row.is_admin,
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

export async function findRecruiterById(id: string): Promise<RecruiterProfile | null> {
  if (demoMode()) {
    const r = demoRecruiters().find((x) => x.id === id && x.active);
    return r ? { ...r } : null;
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_recruiters")
    .select(RECRUITER_COLUMNS)
    .eq("id", id)
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
    const r = demoRecruiters().find((x) => x.id === recruiterId);
    if (r) Object.assign(r, fields);
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

// --- Admin: the recruiter list ------------------------------------------------

export async function listRecruiters(): Promise<RecruiterProfile[]> {
  if (demoMode()) {
    return demoRecruiters().map((r) => ({ ...r }));
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_recruiters")
    .select(RECRUITER_COLUMNS)
    .order("active", { ascending: false })
    .order("display_name");
  if (error) throw new Error(`Recruiter list failed: ${error.message}`);
  return (data as RecruiterRow[]).map(toRecruiter);
}

export type NewRecruiter = { displayName: string; email: string; title: string | null; isAdmin: boolean };

// The portal link name (/c/<slug>/...): from the name, numbered if taken.
function slugFor(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "recruiter";
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

export async function createRecruiter(fields: NewRecruiter): Promise<"ok" | "email_taken"> {
  const email = fields.email.trim().toLowerCase();
  const existing = await listRecruiters();
  if (existing.some((r) => r.calendarEmail.toLowerCase() === email)) return "email_taken";
  const recruiter: RecruiterProfile = {
    id: demoId("recruiter"),
    userId: null,
    slug: slugFor(fields.displayName, new Set(existing.map((r) => r.slug))),
    displayName: fields.displayName,
    title: fields.title,
    photoPath: null,
    bio: null,
    welcomeMessage: null,
    timezone: "Asia/Manila",
    calendarEmail: email,
    active: true,
    isAdmin: fields.isAdmin,
  };
  if (demoMode()) {
    demoStore().otherRecruiters.push(recruiter);
    return "ok";
  }
  const { error } = await supabaseAdmin().from("cos_recruitment_recruiters").insert({
    slug: recruiter.slug,
    display_name: recruiter.displayName,
    title: recruiter.title,
    calendar_email: recruiter.calendarEmail,
    is_admin: recruiter.isAdmin,
  });
  if (error?.code === "23505") return "email_taken"; // added by someone else just now
  if (error) throw new Error(`Adding recruiter failed: ${error.message}`);
  return "ok";
}

export async function setRecruiterAccess(recruiterId: string, fields: { active?: boolean; isAdmin?: boolean }): Promise<void> {
  if (demoMode()) {
    const r = demoRecruiters().find((x) => x.id === recruiterId);
    if (r) Object.assign(r, fields);
    return;
  }
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_recruiters")
    .update({ active: fields.active, is_admin: fields.isAdmin })
    .eq("id", recruiterId);
  if (error) throw new Error(`Updating recruiter failed: ${error.message}`);
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
        stage: d.interview.stage,
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
      "id, interview_id, status, candidate_name, candidate_email, slot_start, slot_end, invite_expires_at, interview:cos_recruitment_interviews!inner(recruiter_id, job_title, client_name, stage)",
    )
    .eq("interview.recruiter_id", recruiterId)
    .or(`created_at.gte.${since},slot_start.gte.${since}`)
    .order("slot_start", { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) throw new Error(`Booking list failed: ${error.message}`);
  return (data ?? []).map((row) => {
    const interview = row.interview as unknown as { job_title: string | null; client_name: string | null; stage: Stage };
    return {
      bookingId: row.id,
      interviewId: row.interview_id,
      status: row.status as BookingStatus,
      candidateName: row.candidate_name,
      candidateEmail: row.candidate_email,
      jobTitle: interview.job_title,
      clientName: interview.client_name,
      stage: interview.stage,
      slotStart: row.slot_start,
      slotEnd: row.slot_end,
      inviteExpiresAt: row.invite_expires_at,
    };
  });
}

export type UpcomingBooking = BookingSummary & { recruiterId: string; recruiterName: string };

// Admin overview: every recruiter's booked interviews from an hour ago onwards.
export async function listUpcomingBookings(limit = 200): Promise<UpcomingBooking[]> {
  const from = DateTime.utc().minus({ hours: 1 }).toISO()!;
  if (demoMode()) {
    return demoInvites()
      .filter((d) => (d.status === "booked" || d.status === "in_progress") && d.slotStart && d.slotStart >= from)
      .map((d) => ({
        bookingId: d.bookingId,
        interviewId: d.interview.id,
        status: d.status,
        candidateName: d.candidateName,
        candidateEmail: d.candidateEmail,
        jobTitle: d.interview.jobTitle,
        clientName: d.interview.clientName,
        stage: d.interview.stage,
        slotStart: d.slotStart,
        slotEnd: d.slotEnd,
        inviteExpiresAt: d.inviteExpiresAt,
        recruiterId: d.recruiter.id,
        recruiterName: d.recruiter.displayName,
      }))
      .sort((a, b) => a.slotStart!.localeCompare(b.slotStart!));
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .select(
      "id, interview_id, status, candidate_name, candidate_email, slot_start, slot_end, invite_expires_at, interview:cos_recruitment_interviews!inner(recruiter_id, job_title, client_name, stage, recruiter:cos_recruitment_recruiters!inner(display_name))",
    )
    .in("status", ["booked", "in_progress"])
    .gte("slot_start", from)
    .order("slot_start", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Upcoming interviews failed: ${error.message}`);
  return (data ?? []).map((row) => {
    const interview = row.interview as unknown as {
      recruiter_id: string;
      job_title: string | null;
      client_name: string | null;
      stage: Stage;
      recruiter: { display_name: string };
    };
    return {
      bookingId: row.id,
      interviewId: row.interview_id,
      status: row.status as BookingStatus,
      candidateName: row.candidate_name,
      candidateEmail: row.candidate_email,
      jobTitle: interview.job_title,
      clientName: interview.client_name,
      stage: interview.stage,
      slotStart: row.slot_start,
      slotEnd: row.slot_end,
      inviteExpiresAt: row.invite_expires_at,
      recruiterId: interview.recruiter_id,
      recruiterName: interview.recruiter.display_name,
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
  stage: Stage,
): Promise<InterviewRound> {
  if (demoMode()) {
    const store = demoStore();
    const existing = store.interviews.find(
      (i) =>
        i.recruiterId === recruiter.id &&
        i.jobadderJobId === job.jobId &&
        i.durationMins === durationMins &&
        i.stage === stage &&
        i.status === "open",
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
      stage,
      createdAt: new Date().toISOString(),
    };
    store.interviews.push(created);
    return created;
  }
  const db = supabaseAdmin();
  const columns = "id, recruiter_id, jobadder_job_id, job_title, client_name, duration_mins, status, stage, created_at";
  const found = await db
    .from("cos_recruitment_interviews")
    .select(columns)
    .eq("recruiter_id", recruiter.id)
    .eq("jobadder_job_id", job.jobId)
    .eq("duration_mins", durationMins)
    .eq("stage", stage)
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
          stage,
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
    stage: row.stage,
    createdAt: row.created_at,
  };
}

// Every candidate's interviews for a JobAdder job, at each stage, by any
// recruiter (cancelled ones left out, so they can be invited again). The
// picker uses it to show who's already invited to a stage and which stages
// they've completed.
export type CandidateStage = { stage: Stage; status: BookingStatus };

export async function stagesForJob(jobId: string): Promise<Map<string, CandidateStage[]>> {
  const out = new Map<string, CandidateStage[]>();
  const add = (candidateId: string, entry: CandidateStage) => out.set(candidateId, [...(out.get(candidateId) ?? []), entry]);
  if (demoMode()) {
    for (const i of demoInvites()) {
      if (i.interview.jobadderJobId === jobId && i.status !== "cancelled") add(i.jobadderCandidateId, { stage: i.interview.stage, status: i.status });
    }
    return out;
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .select("jobadder_candidate_id, status, interview:cos_recruitment_interviews!inner(jobadder_job_id, stage)")
    .eq("interview.jobadder_job_id", jobId)
    .neq("status", "cancelled");
  if (error) throw new Error(`Invite lookup failed: ${error.message}`);
  for (const r of data ?? []) {
    const interview = r.interview as unknown as { stage: Stage };
    add(r.jobadder_candidate_id as string, { stage: interview.stage, status: r.status as BookingStatus });
  }
  return out;
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

const NOTE_COLUMNS = "id, body, offset_ms, created_at, author_id, author_name, author_kind";

type NoteRow = {
  id: number;
  body: string;
  offset_ms: number | null;
  created_at: string;
  author_id: string;
  author_name: string | null;
  author_kind: InterviewNote["authorKind"];
};

const toNote = (n: NoteRow): InterviewNote => ({
  id: String(n.id),
  body: n.body,
  offsetMs: n.offset_ms,
  createdAt: n.created_at,
  authorId: n.author_id,
  authorName: n.author_name,
  authorKind: n.author_kind,
});

export async function listNotes(bookingId: string): Promise<InterviewNote[]> {
  if (demoMode()) return [...(demoStore().notes.get(bookingId) ?? [])];
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_interview_notes")
    .select(NOTE_COLUMNS)
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Loading notes failed: ${error.message}`);
  return (data ?? []).map(toNote);
}

export async function addNote(
  bookingId: string,
  author: { id: string; name: string; kind: InterviewNote["authorKind"] },
  note: { body: string; offsetMs: number | null },
): Promise<InterviewNote> {
  if (demoMode()) {
    const notes = demoStore().notes;
    const created: InterviewNote = {
      id: demoId("note"),
      body: note.body,
      offsetMs: note.offsetMs,
      createdAt: new Date().toISOString(),
      authorId: author.id,
      authorName: author.name,
      authorKind: author.kind,
    };
    notes.set(bookingId, [...(notes.get(bookingId) ?? []), created]);
    return created;
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_interview_notes")
    .insert({
      booking_id: bookingId,
      author_id: author.id,
      author_name: author.name,
      author_kind: author.kind,
      body: note.body,
      offset_ms: note.offsetMs,
    })
    .select(NOTE_COLUMNS)
    .single();
  if (error) throw new Error(`Saving note failed: ${error.message}`);
  return toNote(data as NoteRow);
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
