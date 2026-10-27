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
