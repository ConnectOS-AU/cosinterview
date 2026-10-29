-- Hardening and the pieces the worker and profile editor need.
--
-- 1. Lock the tables down to the server (service role) only.
-- 2. cos_recruitment_claim_slot: books a slot atomically, refusing overlaps
--    with the recruiter's other bookings (no double booking).
-- 3. Columns the transcription worker uses.
-- 4. The public bucket for recruiter photos.
-- 5. Retention: transcripts and notes are deleted a year after the interview,
--    unused invites are closed 90 days after they expire. Runs daily (pg_cron).

-- 1. Access ---------------------------------------------------------------
-- RLS is on with no policies, so anon/authenticated already get nothing. Revoke
-- the table grants as well, so a policy added by mistake later can't open them.
do $$
declare t text;
begin
  foreach t in array array[
    'cos_recruitment_recruiters', 'cos_recruitment_interviews', 'cos_recruitment_bookings',
    'cos_recruitment_interview_notes', 'cos_recruitment_recordings', 'cos_recruitment_recording_tracks',
    'cos_recruitment_transcript_segments', 'cos_recruitment_summaries'
  ] loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- 2. Booking ----------------------------------------------------------------
alter table public.cos_recruitment_bookings
  add constraint cos_recruitment_bookings_slot_order check (slot_end is null or slot_end > slot_start);

-- Returns 'ok', 'taken' (overlaps another booking of the same recruiter) or
-- 'not_invited' (missing, or no longer waiting to be booked). The advisory lock
-- serialises bookings per recruiter, so two candidates can't take the same time.
create or replace function public.cos_recruitment_claim_slot(
  p_booking_id uuid,
  p_slot_start timestamptz,
  p_slot_end timestamptz,
  p_candidate_timezone text,
  p_consent_at timestamptz
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_recruiter uuid;
begin
  select i.recruiter_id into v_recruiter
  from public.cos_recruitment_bookings b
  join public.cos_recruitment_interviews i on i.id = b.interview_id
  where b.id = p_booking_id;
  if v_recruiter is null then
    return 'not_invited';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cos_recruitment:' || v_recruiter::text, 0));

  if exists (
    select 1
    from public.cos_recruitment_bookings b
    join public.cos_recruitment_interviews i on i.id = b.interview_id
    where i.recruiter_id = v_recruiter
      and b.id <> p_booking_id
      and b.status in ('booked', 'in_progress')
      and b.slot_start < p_slot_end
      and b.slot_end > p_slot_start
  ) then
    return 'taken';
  end if;

  update public.cos_recruitment_bookings
  set status = 'booked',
      slot_start = p_slot_start,
      slot_end = p_slot_end,
      candidate_timezone = p_candidate_timezone,
      recording_consent_at = p_consent_at
  where id = p_booking_id and status = 'invited';
  if not found then
    return 'not_invited';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.cos_recruitment_claim_slot(uuid, timestamptz, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.cos_recruitment_claim_slot(uuid, timestamptz, timestamptz, text, timestamptz) to service_role;

-- 3. Transcription worker -----------------------------------------------------
-- Daily raw-tracks start when each participant's audio starts, so each track
-- records its offset from the start of the recording; segment times are stored
-- relative to the recording, after adding it.
alter table public.cos_recruitment_recording_tracks
  add column if not exists track_offset_ms integer not null default 0,
  add column if not exists duration_secs numeric,
  add column if not exists created_at timestamptz not null default now();
create unique index if not exists cos_recruitment_recording_tracks_s3_key_key
  on public.cos_recruitment_recording_tracks (s3_key);
create index if not exists cos_recruitment_recording_tracks_recording_id_idx
  on public.cos_recruitment_recording_tracks (recording_id);
create index if not exists cos_recruitment_recordings_status_idx
  on public.cos_recruitment_recordings (status) where status not in ('done', 'failed');

-- 4. Recruiter photos ---------------------------------------------------------
-- Public read (candidates' pages show them); uploads only via the server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recruitment-public', 'recruitment-public', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 5. Retention ----------------------------------------------------------------
create or replace function public.cos_recruitment_apply_retention(
  p_transcript_days integer default 365,
  p_unused_invite_days integer default 90
) returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Transcripts, summaries, recordings and notes for interviews over a year old.
  -- The booking row stays (who was interviewed, when) for reporting.
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

  -- Invites nobody used: close them and drop the link hash.
  update public.cos_recruitment_bookings
  set status = 'cancelled', invite_token_hash = null
  where status = 'invited'
    and invite_expires_at < now() - make_interval(days => p_unused_invite_days);
end;
$$;

revoke all on function public.cos_recruitment_apply_retention(integer, integer) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'cos_recruitment_retention';
select cron.schedule('cos_recruitment_retention', '15 18 * * *', 'select public.cos_recruitment_apply_retention()');
