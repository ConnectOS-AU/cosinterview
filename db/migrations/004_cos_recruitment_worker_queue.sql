-- Transcription worker queue. A recording row is the job: the Daily webhook
-- creates it (or fills in the one the recruiter's page made when recording
-- started), and the worker claims it, so two workers - or a retry while one is
-- still running - never process the same recording at once.

alter table public.cos_recruitment_recordings
  add column if not exists daily_tracks jsonb,
  add column if not exists claimed_at timestamptz;

-- Claims one recording for processing. Takes pending or failed jobs with
-- attempts left, and jobs stuck mid-run for 30 minutes (e.g. a server restart).
create or replace function public.cos_recruitment_claim_recording(p_recording_id uuid, p_max_attempts integer default 3)
returns boolean
language sql
set search_path = ''
as $$
  with claimed as (
    update public.cos_recruitment_recordings
    set status = 'downloading', attempts = attempts + 1, claimed_at = now(), error = null
    where id = p_recording_id
      and attempts < p_max_attempts
      and (
        status in ('pending', 'failed')
        or (status in ('downloading', 'translating', 'summarising') and claimed_at < now() - interval '30 minutes')
      )
    returning id
  )
  select exists (select 1 from claimed);
$$;

-- Recordings waiting for (another) attempt, oldest first.
create or replace function public.cos_recruitment_recordings_due(p_max_attempts integer default 3, p_limit integer default 5)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select id from public.cos_recruitment_recordings
  where attempts < p_max_attempts
    and daily_tracks is not null
    and (
      status in ('pending', 'failed')
      or (status in ('downloading', 'translating', 'summarising') and claimed_at < now() - interval '30 minutes')
    )
  order by created_at
  limit p_limit;
$$;

revoke all on function public.cos_recruitment_claim_recording(uuid, integer) from public, anon, authenticated;
revoke all on function public.cos_recruitment_recordings_due(integer, integer) from public, anon, authenticated;
grant execute on function public.cos_recruitment_claim_recording(uuid, integer) to service_role;
grant execute on function public.cos_recruitment_recordings_due(integer, integer) to service_role;
