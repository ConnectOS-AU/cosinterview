-- 012: A candidate moving their own booking to another time. Done in one step
-- so they keep their current time unless the new one is really free: takes the
-- same recruiter lock as cos_recruitment_claim_slot, refuses overlaps, and only
-- moves a booking still at the time the candidate was looking at. The room,
-- Outlook entry, reminders and lobby arrival belonged to the old time, so they
-- are cleared. Consent and the candidate's link stay as they are.
--
-- Returns 'ok', 'taken' (overlaps another booking of the same recruiter) or
-- 'not_booked' (already started, cancelled, or moved in another tab).

create or replace function public.cos_recruitment_move_slot(
  p_booking_id uuid,
  p_from_start timestamptz,
  p_slot_start timestamptz,
  p_slot_end timestamptz,
  p_candidate_timezone text
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
    return 'not_booked';
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
  set slot_start = p_slot_start,
      slot_end = p_slot_end,
      candidate_timezone = p_candidate_timezone,
      booked_at = now(),
      candidate_arrived_at = null,
      daily_room_name = null,
      daily_room_url = null,
      graph_event_id = null,
      reminder_24h_sent_at = null,
      reminder_2h_sent_at = null
  where id = p_booking_id and status = 'booked' and slot_start = p_from_start;
  if not found then
    return 'not_booked';
  end if;
  return 'ok';
end;
$$;

revoke all on function public.cos_recruitment_move_slot(uuid, timestamptz, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.cos_recruitment_move_slot(uuid, timestamptz, timestamptz, timestamptz, text) to service_role;
