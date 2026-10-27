-- Recruitment interview platform: recruiters, interviews, bookings, live notes,
-- Daily recordings (one audio track per participant), translated transcripts
-- and AI summaries.
--
-- The candidate's identity is fixed on the booking before the call happens, and
-- each recorded audio track belongs to one participant, so transcripts never
-- have to guess who was speaking.
--
-- RLS is enabled on every table with no policies yet: until policies are added,
-- only server-side code using the service role key can read or write.

-- Recruiter profile shown on the candidate portal
create table public.cos_recruitment_recruiters (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid unique,              -- COSHub user
  slug             text unique not null,     -- used in the portal URL
  display_name     text not null,
  title            text,
  photo_path       text,                     -- Supabase Storage (public bucket)
  bio              text,
  welcome_message  text,
  calendar_email   text not null,            -- Outlook calendar for free/busy
  timezone         text not null default 'Asia/Manila',
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- Interview round for a JobAdder job
create table public.cos_recruitment_interviews (
  id               uuid primary key default gen_random_uuid(),
  recruiter_id     uuid not null references public.cos_recruitment_recruiters(id),
  jobadder_job_id  text not null,
  job_title        text,
  client_name      text,
  duration_mins    int  not null default 30,
  status           text not null default 'open'
                   check (status in ('open', 'closed')),
  created_by       uuid,
  created_at       timestamptz not null default now()
);

-- One row per invited candidate; identity is fixed here, before the call
create table public.cos_recruitment_bookings (
  id                      uuid primary key default gen_random_uuid(),
  interview_id            uuid not null references public.cos_recruitment_interviews(id),
  jobadder_candidate_id   text not null,
  jobadder_application_id text,
  cosid                   text,              -- set only if hired
  candidate_name          text not null,
  candidate_email         text not null,
  invite_token_hash       text unique,
  invite_expires_at       timestamptz,
  slot_start              timestamptz,
  slot_end                timestamptz,
  candidate_timezone      text,
  status                  text not null default 'invited'
                          check (status in ('invited', 'booked', 'in_progress', 'completed', 'cancelled', 'no_show')),
  recording_consent_at    timestamptz,
  graph_event_id          text,              -- Outlook calendar entry for the recruiter
  daily_room_name         text unique,       -- ties recordings back to this booking
  daily_room_url          text,
  created_at              timestamptz not null default now(),
  unique (interview_id, jobadder_candidate_id)
);

-- Live, timestamped recruiter notes (internal only, never shown to candidates)
create table public.cos_recruitment_interview_notes (
  id           bigint generated always as identity primary key,
  booking_id   uuid not null references public.cos_recruitment_bookings(id) on delete cascade,
  author_id    uuid not null,
  offset_ms    int,                          -- position in the call
  body         text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.cos_recruitment_interview_notes (booking_id, offset_ms);

-- One recording session (a booking can have several if the call drops)
create table public.cos_recruitment_recordings (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null references public.cos_recruitment_bookings(id),
  daily_recording_id       text unique,
  daily_meeting_session_id text,
  started_at               timestamptz,
  duration_secs            int,
  status                   text not null default 'pending'
                           check (status in ('pending', 'downloading', 'translating', 'summarising', 'done', 'failed')),
  error                    text,
  attempts                 int not null default 0,
  created_at               timestamptz not null default now(),
  completed_at             timestamptz
);
create index on public.cos_recruitment_recordings (booking_id);
create index on public.cos_recruitment_recordings (status) where status <> 'done';

-- One audio track per participant; speaker identity comes from here
create table public.cos_recruitment_recording_tracks (
  id                    uuid primary key default gen_random_uuid(),
  recording_id          uuid not null references public.cos_recruitment_recordings(id) on delete cascade,
  participant_role      text not null check (participant_role in ('recruiter', 'candidate')),
  daily_participant_id  text,
  s3_key                text,               -- raw track in our S3 bucket
  audio_path            text,               -- compressed .ogg in Supabase Storage
  stt_provider          text,               -- groq
  stt_model             text,               -- whisper-large-v3
  cost_usd              numeric(10,4),
  unique (recording_id, participant_role)
);

-- Translated English transcript, merged from both tracks by time
create table public.cos_recruitment_transcript_segments (
  id            bigint generated always as identity primary key,
  recording_id  uuid not null references public.cos_recruitment_recordings(id) on delete cascade,
  track_id      uuid not null references public.cos_recruitment_recording_tracks(id) on delete cascade,
  speaker_role  text not null check (speaker_role in ('recruiter', 'candidate')),
  start_ms      int  not null,
  end_ms        int  not null,
  text_en       text not null
);
create index on public.cos_recruitment_transcript_segments (recording_id, start_ms);

-- AI summary / assessment
create table public.cos_recruitment_summaries (
  id                     uuid primary key default gen_random_uuid(),
  recording_id           uuid not null references public.cos_recruitment_recordings(id) on delete cascade,
  model                  text,
  summary                text,
  scores                 jsonb,
  written_to_jobadder_at timestamptz,
  created_at             timestamptz not null default now()
);

alter table public.cos_recruitment_recruiters          enable row level security;
alter table public.cos_recruitment_interviews          enable row level security;
alter table public.cos_recruitment_bookings            enable row level security;
alter table public.cos_recruitment_interview_notes     enable row level security;
alter table public.cos_recruitment_recordings          enable row level security;
alter table public.cos_recruitment_recording_tracks    enable row level security;
alter table public.cos_recruitment_transcript_segments enable row level security;
alter table public.cos_recruitment_summaries           enable row level security;
