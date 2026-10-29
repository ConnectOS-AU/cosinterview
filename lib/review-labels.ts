import type { CandidateReview, ReviewQuestion } from "./worker/review";

// Wording for the candidate overview, shared by the server pages and the
// interview screen's question panel.

export const SUITABILITY_LABEL: Record<CandidateReview["suitability"], string> = {
  strong: "Strong fit",
  good: "Good fit",
  possible: "Possible fit",
  unlikely: "Unlikely fit",
};

export const TOPIC_LABEL: Record<ReviewQuestion["topic"], string> = {
  gap: "Gap",
  discrepancy: "Discrepancy",
  verify: "Verify",
  motivation: "Motivation",
};
