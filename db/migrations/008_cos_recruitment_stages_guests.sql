-- 008: Interview stages and client attendees.
-- 1. Each interview round is for one stage (Screening, Interview 1-3, Client
--    Interview 1-3, Job Offer). A candidate can be interviewed at each stage
--    of the same job; earlier rounds were all screening calls.
-- 2. Notes record who wrote them, as client attendees write notes too.
-- 3. Extra attendees invited by email, each with their own link (only its
--    hash is stored): up to 5 client attendees on a client interview, and up
--    to 5 "other" people (another recruiter, a last-minute addition) on any.
-- 4. Which formatted resume (a JobAdder attachment id) client attendees see;
--    null means the newest formatted one.
-- 5. Attendance: who joined each interview call (recruiter, candidate, client
--    attendees), recorded from the recruiter's screen as people join.

alter table public.cos_recruitment_interviews
  add column stage text not null default 'screening'
  check (stage in ('screening', 'interview_1', 'interview_2', 'interview_3',
                   'client_1', 'client_2', 'client_3', 'job_offer'));

alter table public.cos_recruitment_interview_notes
  add column author_name text,
  add column author_kind text not null default 'recruiter' check (author_kind in ('recruiter', 'client', 'other'));

alter table public.cos_recruitment_bookings
  add column client_resume_id text;

create table public.cos_recruitment_guests (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.cos_recruitment_bookings (id) on delete cascade,
  email       text not null,
  name        text,
  role        text not null default 'client' check (role in ('client', 'other')),
  token_hash  text unique not null,
  invited_at  timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create unique index cos_recruitment_guests_booking_email_idx
  on public.cos_recruitment_guests (booking_id, lower(email));

alter table public.cos_recruitment_guests enable row level security;
revoke all on table public.cos_recruitment_guests from anon, authenticated;

create table public.cos_recruitment_attendees (
  id          bigint generated always as identity primary key,
  booking_id  uuid not null references public.cos_recruitment_bookings (id) on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('recruiter', 'candidate', 'client', 'other')),
  joined_at   timestamptz not null default now(),
  unique (booking_id, kind, name)
);

alter table public.cos_recruitment_attendees enable row level security;
revoke all on table public.cos_recruitment_attendees from anon, authenticated;

-- Retention: client attendees go with the transcripts and notes, 12 months
-- after the interview.
create or replace function public.cos_recruitment_apply_retention(
  p_transcript_days integer default 365,
  p_unused_invite_days integer default 90
) returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Transcripts, summaries, recordings, notes, candidate reviews, client
  -- attendees and attendance for interviews over a year old. The booking row stays (who was
  -- interviewed, when) for reporting.
  create temporary table old_bookings on commit drop as
    select id from public.cos_recruitment_bookings
    where slot_end < now() - make_interval(days => p_transcript_days);

  delete from public.cos_recruitment_transcript_segments s
    using public.cos_recruitment_recordings r
    where s.recording_id = r.id and r.booking_id in (select id from old_bookings);
  delete from public.cos_recruitment_summaries s
    using public.cos_recruitment_recordings r
    where s.recording_id = r.id and r.booking_id in (select id from old_bookings);
  delete from public.cos_recruitment_recording_tracks t
    using public.cos_recruitment_recordings r
    where t.recording_id = r.id and r.booking_id in (select id from old_bookings);
  delete from public.cos_recruitment_recordings where booking_id in (select id from old_bookings);
  delete from public.cos_recruitment_interview_notes where booking_id in (select id from old_bookings);
  delete from public.cos_recruitment_candidate_reviews where booking_id in (select id from old_bookings);
  delete from public.cos_recruitment_guests where booking_id in (select id from old_bookings);
  delete from public.cos_recruitment_attendees where booking_id in (select id from old_bookings);

  -- Invites nobody used: close them and drop the link hash.
  update public.cos_recruitment_bookings
  set status = 'cancelled', invite_token_hash = null
  where status = 'invited'
    and invite_expires_at < now() - make_interval(days => p_unused_invite_days);
end;
$$;

revoke all on function public.cos_recruitment_apply_retention(integer, integer) from public, anon, authenticated;
