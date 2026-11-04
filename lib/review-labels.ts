import type { AiResumeCheck, CandidateReview, ReviewQuestion } from "./worker/review";

// Wording for the candidate overview, shared by the server pages and the
// interview screen's question panel.

export const SUITABILITY_LABEL: Record<CandidateReview["suitability"], string> = {
  strong: "Strong fit",
  good: "Good fit",
  possible: "Possible fit",
  unlikely: "Unlikely fit",
  insufficient: "Not enough information yet",
};

export const AI_RESUME_LABEL: Record<AiResumeCheck["verdict"], string> = {
  likely_ai: "Likely AI-written",
  possibly_ai: "Possibly AI-written",
  likely_human: "Likely written by the candidate",
  cannot_tell: "Can't tell",
};

export const TOPIC_LABEL: Record<ReviewQuestion["topic"], string> = {
  gap: "Gap",
  discrepancy: "Discrepancy",
  verify: "Verify",
  motivation: "Motivation",
};
