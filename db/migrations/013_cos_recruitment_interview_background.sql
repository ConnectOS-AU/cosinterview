-- 013: The image a recruiter shows behind them on camera in all their interviews.
-- Stored in the same public bucket as their photo; null means their real background.

alter table public.cos_recruitment_recruiters
  add column if not exists interview_background_path text;
