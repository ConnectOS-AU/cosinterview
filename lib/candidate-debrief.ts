import "server-only";
import { getCandidateReview, listReviewSummaries } from "./candidate-review";
import { demoInvites, demoMode } from "./demo";
import { SUITABILITY_LABEL } from "./review-labels";
import { logToJobAdder } from "./staff/jobadder-api";
import { listNotes } from "./staff/repo";
import { noteLine, STAGES, stageLabel, stagePrefix, type Stage } from "./stages";
import { supabaseAdmin } from "./supabase/admin";
import type { InviteRecord } from "./types";
import { debriefCandidate, type CandidateDebrief } from "./worker/debrief";
import { formatOffset } from "./worker/format";
import { SUMMARY_MODEL, summaryConfigured } from "./worker/summarise";

// The candidate overview after the interview (lib/worker/debrief.ts): written
// once the transcript is ready, kept beside the pre-interview overview on the
// same row, shown on /r/bookings/<id>/overview and added to JobAdder.

export type DebriefState = {
  status: "none" | "running" | "done" | "failed";
  debrief: CandidateDebrief | null;
  error: string | null;
  updatedAt: string | null;
  jobAdderNotedAt: string | null;
};

const NONE: DebriefState = { status: "none", debrief: null, error: null, updatedAt: null, jobAdderNotedAt: null };

type Row = {
  debrief: CandidateDebrief | null;
  debrief_status: DebriefState["status"] | null;
  debrief_error: string | null;
  debrief_updated_at: string | null;
  debrief_jobadder_noted_at: string | null;
};

const demoDebriefs = ((globalThis as typeof globalThis & { __cosrecDemoDebriefs?: Map<string, DebriefState> }).__cosrecDemoDebriefs ??=
  new Map<string, DebriefState>());

export async function getDebrief(bookingId: string): Promise<DebriefState> {
  if (demoMode()) return demoDebriefs.get(bookingId) ?? NONE;
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_candidate_reviews")
    .select("debrief, debrief_status, debrief_error, debrief_updated_at, debrief_jobadder_noted_at")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error) throw new Error(`Post-interview review lookup failed: ${error.message}`);
  const row = data as Row | null;
  if (!row?.debrief_status) return NONE;
  return {
    status: row.debrief_status,
    debrief: row.debrief,
    error: row.debrief_error,
    updatedAt: row.debrief_updated_at,
    jobAdderNotedAt: row.debrief_jobadder_noted_at,
  };
}

async function save(bookingId: string, fields: Partial<Row> & { debrief_model?: string }): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_candidate_reviews")
    .upsert({ booking_id: bookingId, ...fields, debrief_updated_at: new Date().toISOString() }, { onConflict: "booking_id" });
  if (error) throw new Error(`Saving the post-interview review failed: ${error.message}`);
}

// The latest finished transcript for the booking, as the summary reads it.
export async function loadTranscript(bookingId: string): Promise<string | null> {
  const rec = await supabaseAdmin()
    .from("cos_recruitment_recordings")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("status", "done")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rec.error) throw new Error(`Recording lookup failed: ${rec.error.message}`);
  if (!rec.data) return null;
  const segs = await supabaseAdmin()
    .from("cos_recruitment_transcript_segments")
    .select("speaker_role, start_ms, text_en")
    .eq("recording_id", rec.data.id)
    .order("start_ms");
  if (segs.error) throw new Error(`Loading transcript failed: ${segs.error.message}`);
  const text = (segs.data ?? [])
    .map((s) => `[${formatOffset(s.start_ms as number)}] ${s.speaker_role === "recruiter" ? "Recruiter" : "Candidate"}: ${s.text_en}`)
    .join("\n");
  return text || null;
}

// Writes the post-interview review and adds it to JobAdder. Never throws.
export async function runDebrief(invite: InviteRecord, transcript?: string): Promise<"done" | "skipped" | "failed"> {
  if (demoMode()) return runDemoDebrief(invite);
  if (!summaryConfigured()) return "skipped";
  try {
    const text = transcript ?? (await loadTranscript(invite.bookingId));
    if (!text) return "skipped";
    await save(invite.bookingId, { debrief_status: "running", debrief_error: null });
    const [before, notes] = await Promise.all([getCandidateReview(invite.bookingId), listNotes(invite.bookingId)]);
    const debrief = await debriefCandidate({
      jobTitle: invite.interview.jobTitle,
      clientName: invite.interview.clientName,
      candidateName: invite.candidateName,
      stage: stageLabel(invite.interview.stage),
      before: before.status === "done" ? before.review : null,
      transcript: text,
      notes: notes.map((n) => noteLine("", n).trim()),
    });
    await save(invite.bookingId, { debrief, debrief_status: "done", debrief_error: null, debrief_model: SUMMARY_MODEL });
    await logToJobAdder(invite.jobadderCandidateId, debriefNoteText(invite, debrief, before.review?.likelihoodPercent ?? null));
    await save(invite.bookingId, { debrief_jobadder_noted_at: new Date().toISOString() }).catch(() => undefined);
    return "done";
  } catch (err) {
    console.error("[debrief] Post-interview review failed", invite.bookingId, err);
    const message = err instanceof Error ? err.message : String(err);
    await save(invite.bookingId, { debrief_status: "failed", debrief_error: message.slice(0, 500) }).catch(() => undefined);
    return "failed";
  }
}

// --- Timeline -------------------------------------------------------------------

export type TimelinePoint = { bookingId: string; stage: Stage; when: "before" | "after"; percent: number | null; date: string | null };

// The likelihood for this candidate and job through every interview round:
// before and after each one, in stage order.
export async function likelihoodTimeline(invite: InviteRecord): Promise<TimelinePoint[]> {
  type Round = { bookingId: string; stage: Stage; slotStart: string | null; before?: number | null; after?: number | null };
  let rounds: Round[];
  if (demoMode()) {
    const mine = demoInvites().filter(
      (i) => i.jobadderCandidateId === invite.jobadderCandidateId && i.interview.jobadderJobId === invite.interview.jobadderJobId && i.status !== "cancelled",
    );
    const summaries = await listReviewSummaries(mine.map((i) => i.bookingId));
    rounds = mine.map((i) => {
      const s = summaries.get(i.bookingId);
      const d = demoDebriefs.get(i.bookingId);
      return {
        bookingId: i.bookingId,
        stage: i.interview.stage,
        slotStart: i.slotStart,
        before: s?.status === "done" ? s.likelihood : undefined,
        after: d?.status === "done" ? (d.debrief?.likelihoodPercent ?? null) : undefined,
      };
    });
  } else {
    const { data, error } = await supabaseAdmin()
      .from("cos_recruitment_bookings")
      .select(
        "id, slot_start, status, interview:cos_recruitment_interviews!inner(jobadder_job_id, stage), review:cos_recruitment_candidate_reviews(status, debrief_status, before:result->likelihoodPercent, after:debrief->likelihoodPercent)",
      )
      .eq("jobadder_candidate_id", invite.jobadderCandidateId)
      .eq("interview.jobadder_job_id", invite.interview.jobadderJobId)
      .neq("status", "cancelled");
    if (error) throw new Error(`Timeline lookup failed: ${error.message}`);
    type Embedded = { status: string; debrief_status: string | null; before: number | null; after: number | null };
    rounds = (data ?? []).map((b) => {
      const interview = (Array.isArray(b.interview) ? b.interview[0] : b.interview) as { stage: Stage };
      const raw = b.review as Embedded | Embedded[] | null;
      const r = Array.isArray(raw) ? raw[0] : raw;
      return {
        bookingId: b.id as string,
        stage: interview.stage,
        slotStart: b.slot_start as string | null,
        before: r?.status === "done" ? (typeof r.before === "number" ? r.before : null) : undefined,
        after: r?.debrief_status === "done" ? (typeof r.after === "number" ? r.after : null) : undefined,
      };
    });
  }

  const order = (s: Stage) => STAGES.findIndex((x) => x.key === s);
  rounds.sort((a, b) => order(a.stage) - order(b.stage) || (a.slotStart ?? "").localeCompare(b.slotStart ?? ""));
  return rounds.flatMap((r) => [
    ...(r.before !== undefined ? [{ bookingId: r.bookingId, stage: r.stage, when: "before" as const, percent: r.before, date: r.slotStart }] : []),
    ...(r.after !== undefined ? [{ bookingId: r.bookingId, stage: r.stage, when: "after" as const, percent: r.after, date: r.slotStart }] : []),
  ]);
}

// --- The JobAdder note ------------------------------------------------------------

export const NEXT_STEP_LABEL: Record<CandidateDebrief["nextStep"], string> = {
  progress: "Progress",
  progress_with_checks: "Progress, after checks",
  hold: "Hold",
  do_not_progress: "Don't progress",
};

export const OUTCOME_LABEL: Record<CandidateDebrief["answers"][number]["outcome"], string> = {
  resolved: "Resolved",
  partly: "Partly answered",
  concern: "Raised a concern",
  not_asked: "Not asked",
};

export function debriefNoteText(invite: InviteRecord, d: CandidateDebrief, beforePercent: number | null): string {
  const prefix = stagePrefix(invite.interview.stage, invite.slotStart);
  const pct = (p: number | null) => (p === null ? "not enough information" : `${p}%`);
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- None");
  return [
    `${prefix} Candidate overview after the interview - COSInterview (AI-assisted, advisory only)${invite.interview.jobTitle ? ` for ${invite.interview.jobTitle}` : ""}.`,
    `Likelihood of being the successful candidate: ${pct(beforePercent)} before -> ${pct(d.likelihoodPercent)} after (${SUITABILITY_LABEL[d.suitability]}).`,
    d.opinion,
    `Recommendation: ${NEXT_STEP_LABEL[d.nextStep]} - ${d.nextStepReason}`,
    d.answers.length ? `Answers to the suggested questions\n${d.answers.map((a, i) => `${i + 1}. ${a.question}\n   ${OUTCOME_LABEL[a.outcome]}: ${a.answer}`).join("\n")}` : "",
    `Addressed in the interview\n${list(d.addressed.map((p) => `${p.point}: ${p.detail}`))}`,
    `Concerns\n${list(d.concerns.map((p) => `${p.isNew ? "(new) " : ""}${p.point}: ${p.detail}`))}`,
    `Recommendations\n${list(d.recommendations.map((r) => `${r.recommendation} - ${r.detail}`))}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// --- Local demo -------------------------------------------------------------------

const DEMO_DEBRIEF: CandidateDebrief = {
  suitability: "good",
  likelihoodPercent: 71,
  opinion:
    "The interview settled the two biggest doubts: Maria handled inbound calls for eight months in 2022, and her 2024 gap was a planned course. English was clear throughout. Helpdesk experience is lighter than the role wants, which keeps this short of strong.",
  answers: [
    {
      question: "Can you tell me about any experience you have handling customer calls by phone?",
      answer: "Took inbound billing calls for eight months in 2022 before moving to chat, around 60 calls a day [04:12].",
      outcome: "resolved",
    },
    {
      question: "When did you start in your current role, and what has changed in it since you joined?",
      answer: "Joined in March 2022 as a contractor and was made permanent in 2023, which explains the note [07:30].",
      outcome: "resolved",
    },
    {
      question: "Can you walk me through what you were doing between January and June 2024?",
      answer: "Completed a six-month customer experience certificate course [09:05].",
      outcome: "resolved",
    },
    {
      question: "Which helpdesk or ticketing systems have you used, and how did you use them day to day?",
      answer: "Only an in-house ticketing tool; hasn't used Zendesk or Freshdesk [11:40].",
      outcome: "partly",
    },
    {
      question: "Tell me about a billing dispute you resolved that you're proud of.",
      answer: "Described tracing a duplicated charge across two accounts and getting it refunded the same day [14:20].",
      outcome: "resolved",
    },
    { question: "What attracts you to this role in particular?", answer: "Not asked.", outcome: "not_asked" },
  ],
  addressed: [
    { point: "Phone support", detail: "Eight months of inbound billing calls in 2022 [04:12]." },
    { point: "Employment dates", detail: "Contractor from March 2022, permanent from 2023 [07:30]." },
    { point: "Gap in 2024", detail: "A planned certificate course [09:05]." },
  ],
  concerns: [
    { point: "Helpdesk tools", detail: "Only an in-house tool; the client uses Zendesk [11:40].", isNew: false },
    { point: "Salary", detail: "Asked for PHP 38,000, above the client's stated budget [16:55].", isNew: true },
  ],
  recommendations: [
    { recommendation: "Check the 2022 phone role with a reference", detail: "It's the main evidence for the phone requirement." },
    { recommendation: "Discuss salary before the client interview", detail: "Her ask is above the budget in the job notes." },
    { recommendation: "Ask the client how much Zendesk training they give", detail: "The tool gap is learnable if they onboard new starters." },
  ],
  nextStep: "progress_with_checks",
  nextStepReason: "A good fit once the phone reference and salary are confirmed.",
};

function runDemoDebrief(invite: InviteRecord): "done" {
  const now = new Date().toISOString();
  demoDebriefs.set(invite.bookingId, { status: "done", debrief: DEMO_DEBRIEF, error: null, updatedAt: now, jobAdderNotedAt: now });
  console.info("[jobadder note - demo]", invite.jobadderCandidateId, debriefNoteText(invite, DEMO_DEBRIEF, 62));
  return "done";
}
