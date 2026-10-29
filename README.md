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
   Candidates can book the same day, from an hour ahead. They're emailed reminders 24 hours and 2 hours
   before (skipped if they booked less than an hour before a reminder was due), each noted in JobAdder.
   Booking also starts the **candidate overview** (below).
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
| `/c/<recruiter-slug>/<token>` | Welcome (recruiter photo, bio, welcome message), time picker in the candidate's time zone, optional WhatsApp and Viber numbers, recording consent, booking. After booking: confirmation. |
| `/c/<recruiter-slug>/<token>/room` | Interview room. The candidate joins the Daily room **without a meeting token**, so Daily holds them in the lobby; the page shows the ConnectOS waiting screen until the recruiter admits them, then shows the video. |
| `/c/<recruiter-slug>/<token>/invite.ics` | "Add to calendar" download. |
| `/c/<recruiter-slug>/<token>/job` | The job description from JobAdder, linked from the lobby (opens in a new tab so the candidate keeps their place). |
| `/g/<token>` | **Attendee lobby** for an extra person on an interview (a client attendee or Other), from their own emailed link. Shows the candidate's **formatted** resume only (never the original - `/g/<token>/resume`), the job description, and their own notes, which are saved as "[Stage · date] Name (client): ..." and seen by the recruiter. They join the video **without a meeting token** as "Name (client)" / "Name (other)", so they wait in Daily's lobby until the recruiter admits them. **Move to second screen** opens the resume and job description side by side (`/g/<token>/second-screen`). |

- The waiting screen's content is edited by admins at `/r/admin/lobby`; `content/waiting-room.ts` holds the
  default it starts from (placeholder copy - replace it in the editor before go-live).
- Booking rules (working hours, notice, days ahead) are in `lib/availability.ts`.
- **WhatsApp and Viber** (`lib/messaging.ts`, through Infobip): when the candidate gives their numbers,
  the booking confirmation, 24h and 2h reminders, a moved interview and a cancellation go there as well as
  by email, and the JobAdder note says what was sent where. Numbers typed as 09xx are taken as Philippine
  (+63); others need their + and country code. Until Infobip is set up, messages are logged, not sent.
- Recruiter photos come from the public Supabase Storage bucket `recruitment-public`.
- **Local demo:** with `npm run dev`, open `/c/demo/demo` to click through without any
  credentials (`?reset=1` starts it again). The demo is disabled in production.

Daily setup: raw-tracks recording needs an S3 bucket configured on the Daily domain
(`recordings_bucket`) before recordings will work.

## Recruiter screens (in COSHub)

Embedded in COSHub's content pane at `https://interviews.connectos.co/r`, styled like COScomms.

| Route | What it does |
|---|---|
| `/r` | The signed-in recruiter's interviews (with each one's stage): upcoming, awaiting booking, past 30 days. Row actions: **New link** (lost or expired invite), **Reschedule** (frees the time, removes the Outlook entry, new link), **Cancel** (a booked candidate is emailed). Each step adds a JobAdder note. |
| `/r/interviews/new` | Pick a JobAdder job (from the synced `ja_jobs`, open and on hold; search, or filter by client), choose **which interview this is** (Screening, Interview 1-3, Client Interview 1-3, Job Offer - candidates who've completed that stage are hidden), tick candidates with active applications (`ja_applications`), choose the length and add an optional personal message for the emails. Creates the interview and one invite per candidate, emails each through SendGrid in the recruiter's name (replies go to the recruiter) and shows the links to copy, and adds a JobAdder note per candidate with the email's full text. Links are only shown once - only their hash is stored. |
| `/r/profile` | What candidates see: name, title, photo (Supabase Storage `recruitment-public`, 2 MB), welcome message, bio, time zone. |
| `/r/bookings/<id>/overview` | **Candidate overview**, linked from each booked row on `/r` (with its likelihood %). Written by Claude after booking from the candidate's resume (JobAdder attachments), the team's JobAdder notes (`ja_notes`) and application answers (LinkedIn link, salary) against the job description: an opinion and % likelihood of being the successful candidate at the top, then summary, positives, gaps, discrepancies and questions to ask. Also added to the candidate's JobAdder notes. **Regenerate** writes it again. Advisory only; protected attributes are ignored. LinkedIn profiles are never read (sign-in wall, not allowed) - the link is shown for the interviewer to check. |
| `/r/bookings/<id>` | Interview screen: joins the Daily room as owner, an **Admit / Deny** banner when the candidate is in the lobby, recording starts automatically once the candidate is in, and timestamped notes (timed against the recording) under the video and to the right the job description from JobAdder (scrolls, zoom A−/A+, remembered per computer) with the overview's **questions to ask** under it (tick each as asked). **Move to second screen** opens both in their own window (`/r/companion/<id>`) - placed on the other monitor when the browser allows window management, otherwise drag it across - and the interview screen takes them back when it's closed. Above the video: **attendees** - up to 5 client attendees (client interviews) and up to 5 Other (any interview: another recruiter, a last-minute addition), each emailed a personal lobby link - and the candidate's **resumes** (open any version; choose which formatted one attendees see). The lobby banner lists everyone waiting (candidate, client, other) with Admit / Deny each, so clients can be brought in before or after the candidate. Notes from attendees appear in the notes list. **Attended** lists who joined the call. End interview / Mark as no-show - this adds a JobAdder note with who attended and every note, each prefixed with the stage and date. Once completed: summary, scores, notes and the English transcript, and **Add summary to JobAdder**. |
| `/r/admin` | Admins only (`is_admin` on their recruiter profile). Upcoming interviews for every recruiter, the recruiter list (add, deactivate, make admin) and **Work as**: every recruiter screen then runs as that recruiter (their interviews, new interviews, their profile) with a banner and **Back to my account**. Joining an interview while working as someone uses the admin's own name. |
| `/r/admin/lobby` | Admins only. The candidate lobby screen, every panel with a visual / HTML editor: the waiting card (job description link wording, tips), an Interview tips panel, and the ConnectOS panel (headline, content, optional YouTube/Vimeo video, button). Live preview; saved HTML is cleaned (no scripts, styles or embeds) before candidates see it. |
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
   attempts, sends candidates' 24-hour and 2-hour interview reminders, and writes candidate overviews
   that are missing or failed (up to 3 attempts, a few per run). Schedule it every 15 minutes
   on **one** server - without it, no reminders go out.

Reminder links: invite links are looked up by hash, so to put the join link in reminders the token is
also kept encrypted on the booking (AES-256-GCM, key derived from `SUPABASE_SERVICE_ROLE_KEY`) from
booking until a day after the interview. If that key is rotated, reminders go out without the link.

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
- [ ] **Infobip** (WhatsApp and Viber): an account with `INFOBIP_BASE_URL` and `INFOBIP_API_KEY`.
  WhatsApp: a WhatsApp Business sender (`INFOBIP_WHATSAPP_SENDER`) and an approved **utility** template
  named `cosinterview_update` (or set `INFOBIP_WHATSAPP_TEMPLATE`) whose body is just `{{1}}` - the whole
  message goes in that one value, on one line. Viber: a Viber Business sender name (`INFOBIP_VIBER_SENDER`).
  Without these, candidates' numbers are still saved and the JobAdder note says the message wasn't sent.
- [ ] **Worker schedule**: `POST /api/worker/run` every 15 minutes with `WORKER_SECRET`, on one server
  (recording retries and candidate reminders).
- [ ] **COSHub**: merge the cosops iframe change, then add a menu item embedding
  `https://interviews.connectos.co/r` (Admin: menu access).
- [ ] **Recruiter profiles**: an admin adds each recruiter at /r/admin (name and Microsoft email).
  Each recruiter then completes /r/profile, or an admin does it for them with Work as.

Decisions and content (business):

- [ ] Confirm retention periods (12 months / 90 days) with whoever owns privacy, and the privacy
  policy URL in `lib/site.ts`.
- [ ] Final marketing copy and video for the waiting room (an admin edits it at /r/admin/lobby).
- [ ] Booking rules: working hours, notice, days ahead (`lib/availability.ts`).

Test before relying on it:

- [ ] **JobAdder write-back** - the note endpoint in `lib/staff/jobadder-api.ts` couldn't be checked
  against JobAdder's docs; add a summary for one test candidate and confirm it appears. The automatic
  activity notes (invite sent, booked, moved, cancelled) use the same endpoint and only log an error
  if it fails, so check one appears after the first real invite. Also confirm
  refreshing the shared `ja_token` doesn't upset the existing sync.
- [ ] **Candidate overview resume** - the JobAdder attachment endpoints (`lib/review-inputs.ts`) couldn't be
  checked against JobAdder's docs. After the first booking, open its overview: "What it was based on" should
  name the resume file. If it says no resume, `pm2 logs cosinterview --lines 300 --nostream | grep review`
  shows the attachment fields JobAdder returned. Needs `ANTHROPIC_API_KEY`; Word (.docx) and PDF resumes only.
- [ ] **Formatted resume** - attendees only see an attachment whose JobAdder type (or file name) says
  "formatted" (`lib/resumes.ts`). Check one candidate with a formatted resume shows it in the booking page's
  Resumes panel marked Formatted.
- [ ] **Second screen inside COSHub** (optional): for the window to open directly on the other monitor, the
  COSHub iframe's `allow` list also needs `window-management`. Without it the window opens on the same
  screen and the interviewer drags it across.
- [ ] **WhatsApp / Viber** - Infobip's request formats (`lib/messaging.ts`) were written from their
  documentation without a test account. Book a test interview with your own numbers and check both arrive.
- [ ] One end-to-end interview: invite email, booking, Outlook entry, lobby, recording, transcript,
  summary.

## Stack

Next.js, Tailwind and Supabase, matching `connectos-bi-chat`. The brand theme
(`tailwind.config.ts`, `app/globals.css`) and logos in `public/` come from that repo.

## Database

Tables are prefixed `cos_recruitment_` in the ConnectOS Supabase project. Migrations live in
`db/migrations/`, applied in number order: `001` creates the schema, `002` adds foreign-key
indexes, `003` hardening (grants, booking function, photo bucket, retention job), `004` the
worker queue functions, `005` recruiter admins (with Simon as the first admin), `006` reminders
(booking time, encrypted link, sent flags) plus the settings table for the lobby screen, and `007`
candidate overviews (one per booking, claimed by `cos_recruitment_claim_review`, deleted with the
transcripts after 12 months), and `008` interview stages, note authors, extra attendees
(`cos_recruitment_guests`), the formatted resume attendees see, and attendance
(`cos_recruitment_attendees`), and `009` the candidate overview after the interview (on the
same row as the one before) and candidates' WhatsApp and Viber numbers.

## Local setup

```bash
npm install
cp .env.local.example .env.local   # then fill in the values
npm run dev
```

## Git workflow

`main` is protected by convention: all work happens on `simon/work` and reaches `main`
through pull requests.
