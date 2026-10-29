-- 1. Interview reminders: candidates are emailed 24 hours and 2 hours before.
--    The reminders carry the candidate's join link, but only its hash is stored
--    for look-ups, so the link itself is kept encrypted (AES-256-GCM, key held
--    by the server) from booking until the interview is over.
alter table public.cos_recruitment_bookings
  add column booked_at          timestamptz,
  add column invite_link_sealed text,
  add column reminder_24h_sent_at timestamptz,
  add column reminder_2h_sent_at  timestamptz;

-- Bookings made before this migration: treat consent (given at booking) as the booking time.
update public.cos_recruitment_bookings
set booked_at = recording_consent_at
where booked_at is null and status in ('booked', 'in_progress', 'completed', 'no_show');

create index cos_recruitment_bookings_reminders_idx
  on public.cos_recruitment_bookings (slot_start)
  where status = 'booked';

-- The claim function also records when the booking was made.
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
      recording_consent_at = p_consent_at,
      booked_at = now(),
      reminder_24h_sent_at = null,
      reminder_2h_sent_at = null
  where id = p_booking_id and status = 'invited';
  if not found then
    return 'not_invited';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.cos_recruitment_claim_slot(uuid, timestamptz, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.cos_recruitment_claim_slot(uuid, timestamptz, timestamptz, text, timestamptz) to service_role;

-- 2. Site settings edited by recruitment admins (the candidate lobby screen).
create table public.cos_recruitment_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.cos_recruitment_settings enable row level security;
revoke all on table public.cos_recruitment_settings from anon, authenticated;
