-- 009: Candidate overview after the interview. Written from the transcript and
-- everyone's notes against the pre-interview overview, on the same row: the
-- candidate's answers to the suggested questions, what was settled, remaining
-- and new concerns, a new likelihood and recommendations. Removed with the
-- row by the retention job (12 months after the interview).

alter table public.cos_recruitment_candidate_reviews
  add column debrief                   jsonb,
  add column debrief_status            text check (debrief_status in ('running', 'done', 'failed')),
  add column debrief_error             text,
  add column debrief_model             text,
  add column debrief_updated_at        timestamptz,
  add column debrief_jobadder_noted_at timestamptz;

-- The candidate's WhatsApp and Viber numbers (international format, e.g.
-- +639171234567), optional, given when they book. Confirmations, reminders,
-- moved interviews and cancellations go to these as well as by email.
alter table public.cos_recruitment_bookings
  add column whatsapp_number text,
  add column viber_number    text;
