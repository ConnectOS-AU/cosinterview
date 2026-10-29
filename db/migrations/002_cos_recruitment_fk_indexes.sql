-- Covering indexes for foreign keys the Supabase performance advisor flagged
-- after 001: lookups and cascading deletes on these columns would otherwise
-- scan the whole table.
create index on public.cos_recruitment_interviews (recruiter_id);
create index on public.cos_recruitment_summaries (recording_id);
create index on public.cos_recruitment_transcript_segments (track_id);
