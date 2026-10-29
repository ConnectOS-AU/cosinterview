-- 007: Candidate overviews - Claude's pre-interview review of each booked
-- candidate (resume, JobAdder notes, application answers) against the job
-- description. One row per booking; written by the server only.

create table public.cos_recruitment_candidate_reviews (
  booking_id        uuid primary key references public.cos_recruitment_bookings (id) on delete cascade,
  status            text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts          integer not null default 0,
  result            jsonb,
  sources           jsonb,
  model             text,
  error             text,
  started_at        timestamptz,
  jobadder_noted_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index cos_recruitment_candidate_reviews_open_idx
  on public.cos_recruitment_candidate_reviews (status)
  where status <> 'done';

alter table public.cos_recruitment_candidate_reviews enable row level security;
revoke all on table public.cos_recruitment_candidate_reviews from anon, authenticated;

-- Takes the review for one booking so only one server works on it: creates it,
-- or picks up one that's waiting, failed (under the attempt limit) or stuck
-- running for 15 minutes. Returns false when someone else has it or it's done.
create or replace function public.cos_recruitment_claim_review(
  p_booking_id uuid,
  p_max_attempts integer default 3
) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  insert into public.cos_recruitment_candidate_reviews as r (booking_id, status, attempts, started_at, updated_at)
  values (p_booking_id, 'running', 1, now(), now())
  on conflict (booking_id) do update
    set status = 'running',
        attempts = r.attempts + 1,
        started_at = now(),
        error = null,
        updated_at = now()
    where (r.status in ('pending', 'failed') and r.attempts < p_max_attempts)
       or (r.status = 'running' and r.started_at < now() - interval '15 minutes');
  return found;
end;
$$;

revoke all on function public.cos_recruitment_claim_review(uuid, integer) from public, anon, authenticated;
grant execute on function public.cos_recruitment_claim_review(uuid, integer) to service_role;

-- Retention: reviews go with the transcripts, 12 months after the interview.
create or replace function public.cos_recruitment_apply_retention(
  p_transcript_days integer default 365,
  p_unused_invite_days integer default 90
) returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Transcripts, summaries, recordings, notes and candidate reviews for
  -- interviews over a year old. The booking row stays (who was interviewed,
  -- when) for reporting.
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

  -- Invites nobody used: close them and drop the link hash.
  update public.cos_recruitment_bookings
  set status = 'cancelled', invite_token_hash = null
  where status = 'invited'
    and invite_expires_at < now() - make_interval(days => p_unused_invite_days);
end;
$$;

revoke all on function public.cos_recruitment_apply_retention(integer, integer) from public, anon, authenticated;
