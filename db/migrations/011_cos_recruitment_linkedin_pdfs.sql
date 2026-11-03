-- 011: The candidate's LinkedIn profile as a PDF, uploaded by the recruiter on
-- the booking. The candidate overview compares it with the resume. One per
-- booking (a new upload replaces it), held as base64 and written by the server
-- only. Deleted with the rest of the interview's data after 12 months.
-- Also when the candidate first reached the lobby, for the overview's
-- punctuality history (early, on time, late, no-show).

alter table public.cos_recruitment_bookings
  add column candidate_arrived_at timestamptz;

create table public.cos_recruitment_linkedin_pdfs (
  booking_id  uuid primary key references public.cos_recruitment_bookings (id) on delete cascade,
  file_name   text not null,
  size_bytes  integer not null,
  content     text not null,
  uploaded_by text not null,
  uploaded_at timestamptz not null default now()
);

alter table public.cos_recruitment_linkedin_pdfs enable row level security;
revoke all on table public.cos_recruitment_linkedin_pdfs from anon, authenticated;

create or replace function public.cos_recruitment_apply_retention(
  p_transcript_days integer default 365,
  p_unused_invite_days integer default 90
) returns void
language plpgsql
set search_path = ''
as $$
begin
  -- Transcripts, summaries, recordings, notes, candidate reviews, LinkedIn PDFs,
  -- client attendees and attendance for interviews over a year old. The booking
  -- row stays (who was interviewed, when) for reporting.
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
  delete from public.cos_recruitment_linkedin_pdfs where booking_id in (select id from old_bookings);
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
