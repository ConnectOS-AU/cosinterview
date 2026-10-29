import "server-only";
import { demoMode } from "./demo";
import { findInviteById } from "./repo";
import { gatherReviewInputs, type ReviewInputs } from "./review-inputs";
import { jobAdderWriteConfigured, logToJobAdder } from "./staff/jobadder-api";
import { supabaseAdmin } from "./supabase/admin";
import type { InviteRecord } from "./types";
import { SUITABILITY_LABEL } from "./review-labels";
import { reviewCandidate, type CandidateReview } from "./worker/review";
import { SUMMARY_MODEL, summaryConfigured } from "./worker/summarise";

// The candidate overview: once an interview is booked, Claude reviews the
// candidate against the job description (lib/worker/review.ts). The result is
// kept per booking, shown on /r/bookings/<id>/overview and beside the
// interview, and added to the candidate's JobAdder notes. Runs right after
// booking; /api/worker/run retries failures and picks up anything missed.

const MAX_ATTEMPTS = 3;

export type ReviewSources = {
  resumeFile: string | null;
  resumeProblem: string | null;
  jobadderNotes: number;
  jobDescription: boolean;
  linkedinUrl: string | null;
};

export type ReviewState = {
  status: "none" | "pending" | "running" | "done" | "failed";
  review: CandidateReview | null;
  sources: ReviewSources | null;
  model: string | null;
  error: string | null;
  attempts: number;
  updatedAt: string | null;
  jobAdderNotedAt: string | null;
};

const NONE: ReviewState = {
  status: "none",
  review: null,
  sources: null,
  model: null,
  error: null,
  attempts: 0,
  updatedAt: null,
  jobAdderNotedAt: null,
};

type Row = {
  booking_id: string;
  status: ReviewState["status"];
  attempts: number;
  result: CandidateReview | null;
  sources: ReviewSources | null;
  model: string | null;
  error: string | null;
  updated_at: string;
  jobadder_noted_at: string | null;
};

const COLUMNS = "booking_id, status, attempts, result, sources, model, error, updated_at, jobadder_noted_at";

function toState(row: Row): ReviewState {
  return {
    status: row.status,
    review: row.result,
    sources: row.sources,
    model: row.model,
    error: row.error,
    attempts: row.attempts,
    updatedAt: row.updated_at,
    jobAdderNotedAt: row.jobadder_noted_at,
  };
}

export async function getCandidateReview(bookingId: string): Promise<ReviewState> {
  if (demoMode()) return demoReviews.get(bookingId) ?? NONE;
  const { data, error } = await supabaseAdmin().from("cos_recruitment_candidate_reviews").select(COLUMNS).eq("booking_id", bookingId).maybeSingle();
  if (error) throw new Error(`Review lookup failed: ${error.message}`);
  return data ? toState(data as Row) : NONE;
}

// For the interview list: each booking's review status and likelihood.
export async function listReviewSummaries(bookingIds: string[]): Promise<Map<string, { status: ReviewState["status"]; likelihood: number | null }>> {
  const out = new Map<string, { status: ReviewState["status"]; likelihood: number | null }>();
  if (bookingIds.length === 0) return out;
  if (demoMode()) {
    for (const id of bookingIds) {
      const s = demoReviews.get(id);
      if (s) out.set(id, { status: s.status, likelihood: s.review?.likelihoodPercent ?? null });
    }
    return out;
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_candidate_reviews")
    .select("booking_id, status, likelihood:result->likelihoodPercent")
    .in("booking_id", bookingIds);
  if (error) throw new Error(`Review list failed: ${error.message}`);
  for (const r of data ?? []) {
    out.set(r.booking_id as string, { status: r.status as ReviewState["status"], likelihood: typeof r.likelihood === "number" ? r.likelihood : null });
  }
  return out;
}

// --- Running a review ----------------------------------------------------------

async function claim(bookingId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("cos_recruitment_claim_review", { p_booking_id: bookingId, p_max_attempts: MAX_ATTEMPTS });
  if (error) throw new Error(`Review claim failed: ${error.message}`);
  return data === true;
}

async function update(bookingId: string, fields: Partial<Omit<Row, "booking_id">>): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_candidate_reviews")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("booking_id", bookingId);
  if (error) throw new Error(`Saving the review failed: ${error.message}`);
}

function sourcesOf(inputs: ReviewInputs, review: CandidateReview | null): ReviewSources {
  return {
    resumeFile: inputs.resume?.fileName ?? null,
    resumeProblem: inputs.resumeProblem,
    jobadderNotes: inputs.notes.length,
    jobDescription: Boolean(inputs.jobDescription),
    linkedinUrl: inputs.application.linkedinUrl ?? review?.linkedinUrl ?? null,
  };
}

// Reviews one booked candidate, if nobody else is and it isn't done already.
// Never throws: a failure is saved on the review and retried by the worker.
export async function runCandidateReview(invite: InviteRecord): Promise<"done" | "skipped" | "failed"> {
  if (demoMode()) return runDemoReview(invite);
  if (!summaryConfigured()) return "skipped";
  try {
    if (!(await claim(invite.bookingId))) return "skipped";
  } catch (err) {
    console.error("[review] Couldn't start the candidate review", invite.bookingId, err);
    return "failed";
  }

  try {
    const inputs = await gatherReviewInputs(invite);
    const review = await reviewCandidate({
      jobTitle: invite.interview.jobTitle,
      clientName: invite.interview.clientName,
      candidateName: invite.candidateName,
      inputs,
    });
    const sources = sourcesOf(inputs, review);
    await update(invite.bookingId, { status: "done", result: review, sources, model: SUMMARY_MODEL, error: null });

    // The JobAdder note is best-effort, like the other activity notes.
    if (jobAdderWriteConfigured()) {
      await logToJobAdder(invite.jobadderCandidateId, reviewNoteText(invite, review, sources));
      await update(invite.bookingId, { jobadder_noted_at: new Date().toISOString() }).catch(() => undefined);
    }
    return "done";
  } catch (err) {
    console.error("[review] Candidate review failed", invite.bookingId, err);
    const message = err instanceof Error ? err.message : String(err);
    await update(invite.bookingId, { status: "failed", error: message.slice(0, 500) }).catch(() => undefined);
    return "failed";
  }
}

// "Regenerate" on the overview page: starts again with fresh attempts.
export async function regenerateCandidateReview(invite: InviteRecord): Promise<"done" | "skipped" | "failed"> {
  if (demoMode()) {
    demoReviews.delete(invite.bookingId);
    return runDemoReview(invite);
  }
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_candidate_reviews")
    .upsert({ booking_id: invite.bookingId, status: "pending", attempts: 0, error: null, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Resetting the review failed: ${error.message}`);
  return runCandidateReview(invite);
}

// Worker: reviews for upcoming interviews that are missing, failed (under the
// attempt limit) or stuck. A few per run, since each takes a while.
export async function processDueReviews(limit = 3): Promise<number> {
  if (demoMode() || !summaryConfigured()) return 0;
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .select("id, review:cos_recruitment_candidate_reviews(status, attempts, started_at)")
    .in("status", ["booked", "in_progress"])
    .gt("slot_end", new Date().toISOString())
    .order("slot_start")
    .limit(200);
  if (error) throw new Error(`Due reviews lookup failed: ${error.message}`);

  const stuckBefore = Date.now() - 15 * 60_000;
  type Embedded = { status: Row["status"]; attempts: number; started_at: string | null };
  const due = (data ?? []).filter((b) => {
    const raw = b.review as Embedded | Embedded[] | null;
    const r = Array.isArray(raw) ? raw[0] : raw;
    if (!r) return true;
    if (r.status === "pending" || r.status === "failed") return r.attempts < MAX_ATTEMPTS;
    return r.status === "running" && r.started_at !== null && Date.parse(r.started_at) < stuckBefore;
  });

  let done = 0;
  for (const b of due.slice(0, limit)) {
    const invite = await findInviteById(b.id as string);
    if (invite && (await runCandidateReview(invite)) === "done") done++;
  }
  return done;
}

// --- The JobAdder note ------------------------------------------------------------

export function reviewNoteText(invite: InviteRecord, review: CandidateReview, sources: ReviewSources): string {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- None noted");
  const points = (items: { point: string; detail: string }[]) => list(items.map((p) => `${p.point}: ${p.detail}`));
  const based = [
    sources.resumeFile ? `resume (${sources.resumeFile})` : `no resume (${sources.resumeProblem ?? "not found"})`,
    `${sources.jobadderNotes} JobAdder note${sources.jobadderNotes === 1 ? "" : "s"}`,
    sources.jobDescription ? "the job description" : "the job title (no job description in JobAdder)",
    "application answers",
  ].join(", ");
  return [
    `Candidate overview before interview - COSInterview (AI-assisted, advisory only)${invite.interview.jobTitle ? ` for ${invite.interview.jobTitle}` : ""}.`,
    review.likelihoodPercent === null
      ? "Pre-interview opinion: not enough information to judge - no resume or notes about the candidate yet. Ask them for a resume before the interview."
      : `Pre-interview opinion: ${SUITABILITY_LABEL[review.suitability]}, ${review.likelihoodPercent}% likelihood of being the successful candidate.`,
    review.opinion,
    `Summary\n${review.summary}`,
    `Positives\n${list(review.positives)}`,
    `Gaps\n${points(review.gaps)}`,
    `Discrepancies\n${points(review.discrepancies)}`,
    `Questions to ask\n${review.questions.map((q, i) => `${i + 1}. ${q.question} (${q.purpose})`).join("\n")}`,
    `Based on: ${based}.${sources.linkedinUrl ? `\nLinkedIn: ${sources.linkedinUrl} - not reviewed automatically; check it before the interview.` : ""}`,
  ].join("\n\n");
}

// --- Local demo -------------------------------------------------------------------

const demoReviews = ((globalThis as typeof globalThis & { __cosrecDemoReviews?: Map<string, ReviewState> }).__cosrecDemoReviews ??=
  new Map());

const DEMO_REVIEW: CandidateReview = {
  suitability: "good",
  likelihoodPercent: 62,
  opinion:
    "A credible fit: three years of Australian telco support lines up well with the role, and the notes describe clear English. Phone experience and the reason for her 2024 gap are the open questions that will decide it.",
  summary:
    "Maria has three years of chat and email support for an Australian telco at a Pasig BPO, plus a year in retail before that. The role asks for 2+ years of customer support and excellent written and spoken English, which her resume and the recruiter's screening note both support. The job also involves phone support, and her resume only mentions chat and email. Her expected salary is a little above what the notes say the client budgeted.",
  positives: [
    "Three years supporting Australian telco customers - directly relevant (resume).",
    "Screening call note describes clear, confident English (JobAdder note, 14 Oct).",
    "Already works Sydney business hours (resume).",
  ],
  gaps: [
    { point: "Phone support", detail: "The role includes phone support; the resume only lists chat and email." },
    { point: "Helpdesk tools", detail: "The job asks for logging in a helpdesk; no ticketing system is named in the resume." },
  ],
  discrepancies: [
    {
      point: "Employment dates",
      detail: "The resume shows her current role from March 2022, but the screening note says she started in 2023.",
    },
    { point: "Gap in 2024", detail: "No role is listed between January and June 2024." },
  ],
  questions: [
    {
      question: "Can you tell me about any experience you have handling customer calls by phone?",
      purpose: "Checks the phone support gap.",
      topic: "gap",
    },
    {
      question: "When did you start in your current role, and what has changed in it since you joined?",
      purpose: "Clears up the 2022 / 2023 start date difference.",
      topic: "discrepancy",
    },
    {
      question: "Can you walk me through what you were doing between January and June 2024?",
      purpose: "The six months not covered by the resume - ask neutrally.",
      topic: "discrepancy",
    },
    {
      question: "Which helpdesk or ticketing systems have you used, and how did you use them day to day?",
      purpose: "Checks the helpdesk tools requirement.",
      topic: "gap",
    },
    {
      question: "Tell me about a billing dispute you resolved that you're proud of.",
      purpose: "Verifies the depth of her telco experience.",
      topic: "verify",
    },
    { question: "What attracts you to this role in particular?", purpose: "Motivation for the move.", topic: "motivation" },
  ],
  linkedinUrl: "https://www.linkedin.com/in/maria-santos-example",
};

// Someone the team knows nothing about yet: no resume, no notes.
const DEMO_UNKNOWN: CandidateReview = {
  suitability: "insufficient",
  likelihoodPercent: null,
  opinion:
    "There's nothing to judge this candidate on yet: no resume on JobAdder, no notes and no application answers. Ask them for a resume before the interview, and use the questions below to cover the basics.",
  summary: "No resume, JobAdder notes or application answers were found, so the candidate's experience against the role is unknown.",
  positives: [],
  gaps: [{ point: "Experience unknown", detail: "Nothing in the sources shows their background against the role's requirements." }],
  discrepancies: [],
  questions: [
    { question: "Can you walk me through your current or most recent role, and what a typical day looks like?", purpose: "Establishes their background.", topic: "gap" },
    { question: "How many years have you worked in customer support, and in which channels - phone, chat or email?", purpose: "The role's core requirement.", topic: "gap" },
    { question: "Which helpdesk or ticketing systems have you used?", purpose: "The job asks for helpdesk logging.", topic: "gap" },
    { question: "What's your notice period, and when could you start?", purpose: "Availability.", topic: "verify" },
    { question: "What salary are you looking for in your next role?", purpose: "Salary expectations.", topic: "verify" },
    { question: "What made you interested in this role?", purpose: "Motivation.", topic: "motivation" },
  ],
  linkedinUrl: null,
};

function runDemoReview(invite: InviteRecord): "done" {
  if (demoReviews.get(invite.bookingId)?.status === "done") return "done";
  const known = invite.jobadderCandidateId === "5001";
  const review = known ? DEMO_REVIEW : DEMO_UNKNOWN;
  const sources: ReviewSources = {
    resumeFile: known ? "Maria Santos CV.pdf" : null,
    resumeProblem: known ? null : "No resume on JobAdder.",
    jobadderNotes: known ? 3 : 0,
    jobDescription: invite.interview.jobadderJobId === "1001",
    linkedinUrl: review.linkedinUrl,
  };
  const now = new Date().toISOString();
  demoReviews.set(invite.bookingId, {
    status: "done",
    review,
    sources,
    model: "demo",
    error: null,
    attempts: 1,
    updatedAt: now,
    jobAdderNotedAt: now,
  });
  console.info("[jobadder note - demo]", invite.jobadderCandidateId, reviewNoteText(invite, review, sources));
  return "done";
}
