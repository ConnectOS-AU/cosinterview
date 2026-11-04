import "server-only";
import { DateTime } from "luxon";
import { getDebrief } from "./candidate-debrief";
import { getCandidateReview } from "./candidate-review";
import { demoInvites, demoMode } from "./demo";
import { getInterviewRecord, type InterviewRecord } from "./staff/transcripts";
import { listNotes } from "./staff/repo";
import { noteForAi, STAGES, stageLabel, type Stage } from "./stages";
import { supabaseAdmin } from "./supabase/admin";
import type { BookingStatus, InterviewNote, InviteRecord } from "./types";
import type { CandidateDebrief } from "./worker/debrief";
import { formatOffset } from "./worker/format";

// Every interview a candidate has had for a job: everyone's comments, the scores
// and summary, the transcript and how the likelihood moved. It's shown on the
// overview page and read when the overview for a later interview is written, so
// each stage builds on the ones before it.

const MAX_TRANSCRIPT_CHARS = 40_000;

export type HistoryRound = {
  bookingId: string;
  stage: Stage;
  status: BookingStatus;
  slotStart: string | null;
  interviewer: string | null;
  notes: InterviewNote[];
  record: InterviewRecord | null;
  before: number | null;
  after: number | null;
  debrief: CandidateDebrief | null;
};

type Booking = Pick<HistoryRound, "bookingId" | "stage" | "status" | "slotStart" | "interviewer">;

const stageOrder = (stage: Stage) => STAGES.findIndex((s) => s.key === stage);
const finished = (status: BookingStatus) => status === "completed" || status === "no_show";

async function bookingsFor(invite: InviteRecord): Promise<Booking[]> {
  if (demoMode()) {
    return demoInvites()
      .filter((i) => i.jobadderCandidateId === invite.jobadderCandidateId && i.interview.jobadderJobId === invite.interview.jobadderJobId && i.status !== "cancelled")
      .map((i) => ({ bookingId: i.bookingId, stage: i.interview.stage, status: i.status, slotStart: i.slotStart, interviewer: i.recruiter.displayName }));
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .select("id, slot_start, status, interview:cos_recruitment_interviews!inner(jobadder_job_id, stage, recruiter:cos_recruitment_recruiters(display_name))")
    .eq("jobadder_candidate_id", invite.jobadderCandidateId)
    .eq("interview.jobadder_job_id", invite.interview.jobadderJobId)
    .neq("status", "cancelled");
  if (error) throw new Error(`Interview history lookup failed: ${error.message}`);
  type Interview = { stage: Stage; recruiter: { display_name: string } | { display_name: string }[] | null };
  return (data ?? []).map((b) => {
    const interview = (Array.isArray(b.interview) ? b.interview[0] : b.interview) as Interview;
    const recruiter = Array.isArray(interview.recruiter) ? interview.recruiter[0] : interview.recruiter;
    return {
      bookingId: b.id as string,
      stage: interview.stage,
      status: b.status as BookingStatus,
      slotStart: b.slot_start as string | null,
      interviewer: recruiter?.display_name ?? null,
    };
  });
}

// All their interviews for this job, earliest stage first.
export async function interviewHistory(invite: InviteRecord): Promise<HistoryRound[]> {
  const bookings = await bookingsFor(invite);
  bookings.sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || (a.slotStart ?? "").localeCompare(b.slotStart ?? ""));
  return Promise.all(
    bookings.map(async (booking) => {
      const done = booking.status === "completed";
      const [notes, record, review, debrief] = await Promise.all([
        listNotes(booking.bookingId),
        done ? getInterviewRecord(booking.bookingId) : null,
        getCandidateReview(booking.bookingId),
        getDebrief(booking.bookingId),
      ]);
      return {
        ...booking,
        notes,
        record,
        before: review.status === "done" ? (review.review?.likelihoodPercent ?? null) : null,
        after: debrief.status === "done" ? (debrief.debrief?.likelihoodPercent ?? null) : null,
        debrief: debrief.status === "done" ? debrief.debrief : null,
      };
    }),
  );
}

// The finished interviews from stages before this one, plus any at this stage they
// missed: a second chance follows a no-show at the same stage.
export async function earlierRounds(invite: InviteRecord): Promise<HistoryRound[]> {
  const own = stageOrder(invite.interview.stage);
  return (await interviewHistory(invite)).filter((r) => r.bookingId !== invite.bookingId && finished(r.status) && stageOrder(r.stage) <= own);
}

// Bookings for a later stage that haven't started, whose overview should catch
// up when an earlier interview's overview changes.
export async function upcomingBookingIds(invite: InviteRecord): Promise<string[]> {
  const own = stageOrder(invite.interview.stage);
  return (await bookingsFor(invite)).filter((b) => (b.status === "invited" || b.status === "booked") && stageOrder(b.stage) > own).map((b) => b.bookingId);
}

const percent = (value: number | null) => (value === null ? "no figure" : `${value}%`);

// The earlier interviews as the model reads them. Null when there are none.
export function earlierInterviewsText(rounds: HistoryRound[]): string | null {
  if (rounds.length === 0) return null;
  return rounds
    .map((round) => {
      const date = round.slotStart ? DateTime.fromISO(round.slotStart, { zone: "Asia/Manila" }).toFormat("d LLL yyyy") : "date not recorded";
      const header = `${stageLabel(round.stage)}, ${date}${round.interviewer ? `, with ${round.interviewer}` : ""}`;
      const comments = `Everyone's comments:\n${round.notes.map((n) => `- ${noteForAi(n)}`).join("\n") || "(none)"}`;
      if (round.status === "no_show") return `<interview>\n${header}\nThe candidate didn't attend.\n${comments}\n</interview>`;
      const summary = round.record?.summary;
      const d = round.debrief;
      const transcript = (round.record?.lines ?? [])
        .map((l) => `[${formatOffset(l.startMs)}] ${l.speaker === "recruiter" ? "Recruiter" : "Candidate"}: ${l.text}`)
        .join("\n");
      return [
        "<interview>",
        header,
        `Likelihood: ${percent(round.before)} before, ${percent(round.after)} after`,
        ...(summary
          ? [
              `Scores out of 5: communication ${summary.scores.communication}, English ${summary.scores.englishFluency}, experience ${summary.scores.relevantExperience}, motivation ${summary.scores.motivation}`,
              `Summary: ${summary.summary}`,
            ]
          : []),
        ...(d
          ? [
              `View after the interview: ${d.opinion}`,
              `Next step recommended: ${d.nextStep} - ${d.nextStepReason}`,
              `Concerns left open: ${d.concerns.map((c) => `${c.point} (${c.detail})`).join("; ") || "none"}`,
              `Recommendations: ${d.recommendations.map((r) => `${r.recommendation} (${r.detail})`).join("; ") || "none"}`,
            ]
          : []),
        comments,
        `Transcript:\n${transcript.slice(0, MAX_TRANSCRIPT_CHARS) || "(no transcript)"}`,
        "</interview>",
      ].join("\n");
    })
    .join("\n\n");
}
