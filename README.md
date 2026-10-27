# ConnectOS Recruitment

Interview booking, video interviews and translated transcripts for ConnectOS recruitment.

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
   Booking creates a Daily room named after the booking and an Outlook calendar entry.
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
| `/r` | The signed-in recruiter's interviews: upcoming, awaiting booking, past 30 days. |
| `/r/bookings/<id>` | Interview screen: joins the Daily room as owner, an **Admit / Deny** banner when the candidate is in the lobby, recording starts automatically once the candidate is in, and timestamped notes (timed against the recording) beside the video. End interview / Mark as no-show. |
| `/r/login` | Microsoft sign-in (Supabase Auth, Azure provider - same as COSHub). Inside COSHub's frame it opens in a pop-up, because Microsoft's sign-in can't be framed. |

- Access follows COSHub's rule: the person must be an active SCIM-provisioned COSHub user.
  They then see interviews for the recruiter profile whose `calendar_email` matches their email.
- Only `COSHUB_ORIGIN` may frame `/r`; candidate pages can't be framed at all.
- **COSHub change needed:** the content-pane iframe (`src/components/core/ContentPanel.tsx` in
  cosops) must allow `camera; microphone; display-capture; autoplay; fullscreen`, or the video
  can't use the recruiter's camera.
- **Supabase change needed:** add `https://interviews.connectos.co/r/auth/callback` to the
  Auth redirect allow list.
- Local demo: without Supabase settings, `npm run dev` signs you in as the demo recruiter at `/r`.

## Stack

Next.js, Tailwind and Supabase, matching `connectos-bi-chat`. The brand theme
(`tailwind.config.ts`, `app/globals.css`) and logos in `public/` come from that repo.

## Database

Tables are prefixed `cos_recruitment_` in the ConnectOS Supabase project. Migrations live in
`db/migrations/`, applied in number order: `001_cos_recruitment_tables.sql` creates the full
schema and `002_cos_recruitment_fk_indexes.sql` adds foreign-key indexes. Both are applied to
the ConnectOS Database project.

## Local setup

```bash
npm install
cp .env.local.example .env.local   # then fill in the values
npm run dev
```

## Git workflow

`main` is protected by convention: all work happens on `simon/work` and reaches `main`
through pull requests.
