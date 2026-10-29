# COSInterview

Interview booking, video interviews and translated transcripts for ConnectOS recruitment.
GitHub: `ConnectOS-AU/COSInterview`. Candidates and recruiters use it at `interviews.connectos.co`;
candidates see it as "ConnectOS Interviews".

- **Candidate portal** at `interviews.connectos.co`: a standalone public site in
  connectos.co branding. Candidates open their invite link, see their recruiter's photo and
  welcome message, book a time, and join the video interview in the browser.
- **Recruiter screens** embedded in the COSHub content pane, styled like COScomms: create
  interviews from JobAdder jobs, invite candidates, run the interview with live notes, and
  review the transcript and summary.
- **Client portal** (later), also on `interviews.connectos.co`.

## How it works

1. A recruiter creates an interview for a JobAdder job and invites candidates. Each
   candidate gets a signed, expiring link.
2. The candidate books a slot from the recruiter's Outlook free/busy time (Microsoft Graph).
   Booking creates a Daily room named after the booking, an entry in the recruiter's Outlook
   calendar linking to their interview screen, and a confirmation email to the candidate (SendGrid,
   in the recruiter's name) with the time in their zone, the join link and a calendar file
   (.ics attachment plus Google / Outlook.com links). JobAdder gets a note with the chosen time and the confirmation email.
3. Recruiter and candidate join from their own pages. Daily records each participant's
   audio as a separate track (raw-tracks, into our S3 bucket). The recruiter types
   timestamped notes during the call.
4. When the recording is ready, a worker downloads both tracks, compresses them with ffmpeg,
   translates each from Tagalog/English to English text with Whisper (Groq), merges the
   segments by time labelled recruiter / candidate, writes a summary, and stores everything
   in Supabase.

## Candidate portal

| Route | What it does |
|---|---|
| `/c/<recruiter-slug>/<token>` | Welcome (recruiter photo, bio, welcome message), time picker in the candidate's time zone, recording consent, booking. After booking: confirmation. |
| `/c/<recruiter-slug>/<token>/room` | Interview room. The candidate joins the Daily room **without a meeting token**, so Daily holds them in the lobby; the page shows the ConnectOS waiting screen until the recruiter admits them, then shows the video. |
| `/c/<recruiter-slug>/<token>/invite.ics` | "Add to calendar" download. |

- Waiting-screen marketing content lives in `content/waiting-room.ts` (placeholder copy marked).
- Booking rules (working hours, notice, days ahead) are in `lib/availability.ts`.
- Recruiter photos come from the public Supabase Storage bucket `recruitment-public`.
- **Local demo:** with `npm run dev`, open `/c/demo/demo` to click through without any
  credentials (`?reset=1` starts it again). The demo is disabled in production.

Daily setup: raw-tracks recording needs an S3 bucket configured on the Daily domain
(`recordings_bucket`) before recordings will work.

## Recruiter screens (in COSHub)

Embedded in COSHub's content pane at `https://interviews.connectos.co/r`, styled like COScomms.

| Route | What it does |
|---|---|
| `/r` | The signed-in recruiter's interviews: upcoming, awaiting booking, past 30 days. Row actions: **New link** (lost or expired invite), **Reschedule** (frees the time, removes the Outlook entry, new link), **Cancel** (a booked candidate is emailed). Each step adds a JobAdder note. |
| `/r/interviews/new` | Pick a JobAdder job (from the synced `ja_jobs`, open and on hold), tick candidates with active applications (`ja_applications`), choose the length and add an optional personal message for the emails. Creates the interview and one invite per candidate, emails each through SendGrid in the recruiter's name (replies go to the recruiter) and shows the links to copy, and adds a JobAdder note per candidate with the email's full text. Links are only shown once - only their hash is stored. |
| `/r/profile` | What candidates see: name, title, photo (Supabase Storage `recruitment-public`, 2 MB), welcome message, bio, time zone. |
| `/r/bookings/<id>` | Interview screen: joins the Daily room as owner, an **Admit / Deny** banner when the candidate is in the lobby, recording starts automatically once the candidate is in, and timestamped notes (timed against the recording) beside the video. End interview / Mark as no-show. Once completed: summary, scores, notes and the English transcript, and **Add summary to JobAdder**. |
| `/r/admin` | Admins only (`is_admin` on their recruiter profile). Upcoming interviews for every recruiter, the recruiter list (add, deactivate, make admin) and **Work as**: every recruiter screen then runs as that recruiter (their interviews, new interviews, their profile) with a banner and **Back to my account**. Joining an interview while working as someone uses the admin's own name. |
| `/r/login` | Microsoft sign-in (Supabase Auth, Azure provider - same as COSHub). Inside COSHub's frame it opens in a pop-up, because Microsoft's sign-in can't be framed. |

- Access follows COSHub's rule: the person must be an active SCIM-provisioned COSHub user.
  They then see interviews for the recruiter profile whose `calendar_email` matches their email.
- Only `COSHUB_ORIGIN` may frame `/r`; candidate pages can't be framed at all.
- **COSHub change needed:** the content-pane iframe (`src/components/core/ContentPanel.tsx` in
  cosops) must allow `camera; microphone; display-capture; autoplay; fullscreen`, or the video
  can't use the recruiter's camera.
- **Supabase change needed:** add `https://interviews.connectos.co/r/auth/callback` to the
  Auth redirect allow list.
- Local demo: without `NEXT_PUBLIC_SUPABASE_URL`, `npm run dev` signs you in as the demo recruiter
  at `/r`, with sample JobAdder jobs and an in-memory store - invites you create open at the links
  shown. Photo upload needs Supabase.

## Transcription worker

Runs inside the same Next.js server (no separate service):

1. Daily calls `POST /api/daily/webhook` with `recording.ready-to-download` (signature checked).
   The recording is saved against the booking whose room it was, then processed after the response.
2. Each participant's raw audio track is downloaded from S3 and compressed with ffmpeg (mono,
   16 kHz Opus, ~11 MB/hour).
3. Groq `whisper-large-v3` **translations** turns Tagalog/English/Taglish audio into English text.
   Segments Whisper marks as non-speech, loops and the usual phantom lines ("Thank you for
   watching") are dropped, since each track is mostly silence while the other person talks.
4. Segments are placed on one timeline using each track's start offset, labelled recruiter
   (the participant whose Daily `user_id` is `recruiter:<id>`) or candidate.
5. Claude writes the summary and 1-5 scores from the transcript plus the recruiter's notes.
6. `POST /api/worker/run` (Bearer `WORKER_SECRET`) retries failed or stuck recordings, up to 3
   attempts; schedule it every 15 minutes.

Approximate running cost per 30-minute interview: Groq about $0.11 (two 30-minute tracks at its
per-hour rate), Claude summary a few cents, Daily within its free participant minutes at low volume.

## Data rules

- All `cos_recruitment_` tables: RLS on, no policies, and no grants for `anon` / `authenticated` -
  only this server (service role) can read or write them.
- Booking goes through `cos_recruitment_claim_slot`, which locks the recruiter and refuses a time
  that overlaps another of their bookings, so two candidates can't take the same slot.
- Retention (`cos_recruitment_apply_retention`, pg_cron daily at 02:15 Manila): transcripts,
  summaries, recordings metadata and notes are deleted **12 months** after the interview; invites
  never used are closed 90 days after expiry. Raw audio stays in S3 - set a lifecycle rule there.

## Go-live checklist

Accounts and access (IT / admin):

- [ ] **Hosting + DNS**: deploy this app on the COSHub server, `interviews.connectos.co` pointing at it
  over HTTPS. Install **ffmpeg** on the server.
- [ ] **Environment**: fill every value in `.env.local.example` on the server.
- [ ] **Supabase Auth**: add `https://interviews.connectos.co/r/auth/callback` to the redirect allow list.
- [ ] **Daily**: paid account (raw-tracks recording), API key, and the domain's recordings bucket set to
  our S3 bucket (`recordings_bucket` with an IAM role Daily can assume). Then create the webhook with
  `DAILY_WEBHOOK_SECRET` as `hmac` (command in `app/api/daily/webhook/route.ts`).
- [ ] **S3**: private bucket, lifecycle rule deleting raw tracks after 30-90 days,
  read-only key for the worker.
- [ ] **Microsoft Graph**: app registration with the application permission `Calendars.ReadWrite`,
  admin consent, and an **application access policy** limiting it to recruiter mailboxes.
  Until then, `CALENDAR_OPTIONAL=true` lets candidates book anyway: only times already booked in
  COSInterview are blocked (not the recruiter's other meetings) and no Outlook entries are made.
  Without Graph and without this setting, candidate booking pages show an error.
- [ ] **SendGrid**: COSHub's API key, and a verified sender for `SENDGRID_FROM_EMAIL` (or domain
  authentication for connectos.co). Send one test invite to yourself first.
- [ ] **Groq** and **Anthropic** API keys.
- [ ] **Worker schedule**: `POST /api/worker/run` every 15 minutes with `WORKER_SECRET`.
- [ ] **COSHub**: merge the cosops iframe change, then add a menu item embedding
  `https://interviews.connectos.co/r` (Admin: menu access).
- [ ] **Recruiter profiles**: an admin adds each recruiter at /r/admin (name and Microsoft email).
  Each recruiter then completes /r/profile, or an admin does it for them with Work as.

Decisions and content (business):

- [ ] Confirm retention periods (12 months / 90 days) with whoever owns privacy, and the privacy
  policy URL in `lib/site.ts`.
- [ ] Final marketing copy and video for the waiting room (`content/waiting-room.ts`).
- [ ] Booking rules: working hours, notice, days ahead (`lib/availability.ts`).

Test before relying on it:

- [ ] **JobAdder write-back** - the note endpoint in `lib/staff/jobadder-api.ts` couldn't be checked
  against JobAdder's docs; add a summary for one test candidate and confirm it appears. The automatic
  activity notes (invite sent, booked, moved, cancelled) use the same endpoint and only log an error
  if it fails, so check one appears after the first real invite. Also confirm
  refreshing the shared `ja_token` doesn't upset the existing sync.
- [ ] One end-to-end interview: invite email, booking, Outlook entry, lobby, recording, transcript,
  summary.

## Stack

Next.js, Tailwind and Supabase, matching `connectos-bi-chat`. The brand theme
(`tailwind.config.ts`, `app/globals.css`) and logos in `public/` come from that repo.

## Database

Tables are prefixed `cos_recruitment_` in the ConnectOS Supabase project. Migrations live in
`db/migrations/`, applied in number order: `001` creates the schema, `002` adds foreign-key
indexes, `003` hardening (grants, booking function, photo bucket, retention job), `004` the
worker queue functions and `005` recruiter admins (with Simon as the first admin). All five are
applied to the ConnectOS Database project.

## Local setup

```bash
npm install
cp .env.local.example .env.local   # then fill in the values
npm run dev
```

## Git workflow

`main` is protected by convention: all work happens on `simon/work` and reaches `main`
through pull requests.
