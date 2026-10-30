import "server-only";
import { getCandidateReview } from "./candidate-review";
import { demoMode } from "./demo";
import { applicationAnswers } from "./review-inputs";
import { supabaseAdmin } from "./supabase/admin";
import type { InviteRecord } from "./types";

// The mandatory LinkedIn check. LinkedIn can't be read automatically (it needs
// a sign-in and doesn't allow it), so when the candidate's resume or JobAdder
// application gives a LinkedIn profile, the recruiter compares it with the
// resume and records the result before they can join the interview. Stored on
// the booking (cos_recruitment_bookings.linkedin_check), added to JobAdder,
// and given to the post-interview overview.

export type LinkedinOutcome = "matches" | "differences" | "not_found";
export type LinkedinCheck = { url: string; outcome: LinkedinOutcome; note: string | null; checkedBy: string; checkedAt: string };

export const LINKEDIN_OUTCOME_LABEL: Record<LinkedinOutcome, string> = {
  matches: "Matches the resume",
  differences: "Differences from the resume",
  not_found: "Profile couldn't be found or opened",
};

const store = globalThis as typeof globalThis & { __cosrecLinkedin?: Map<string, LinkedinCheck> };

// The profile to check: the one in the JobAdder application, or the one the
// pre-interview overview found in the resume. Null when neither gives one.
export async function linkedinUrlFor(invite: InviteRecord): Promise<string | null> {
  const review = await getCandidateReview(invite.bookingId);
  if (review.sources?.linkedinUrl) return review.sources.linkedinUrl;
  if (demoMode()) return null;
  return (await applicationAnswers(invite.jobadderApplicationId)).linkedinUrl;
}

export async function getLinkedinCheck(bookingId: string): Promise<LinkedinCheck | null> {
  if (demoMode()) return store.__cosrecLinkedin?.get(bookingId) ?? null;
  const { data, error } = await supabaseAdmin().from("cos_recruitment_bookings").select("linkedin_check").eq("id", bookingId).maybeSingle();
  if (error) throw new Error(`Reading the LinkedIn check failed: ${error.message}`);
  return (data?.linkedin_check as LinkedinCheck | null) ?? null;
}

export async function saveLinkedinCheck(bookingId: string, check: LinkedinCheck): Promise<void> {
  if (demoMode()) {
    (store.__cosrecLinkedin ??= new Map()).set(bookingId, check);
    return;
  }
  const { error } = await supabaseAdmin().from("cos_recruitment_bookings").update({ linkedin_check: check }).eq("id", bookingId);
  if (error) throw new Error(`Saving the LinkedIn check failed: ${error.message}`);
}

// The JobAdder note, and the line the post-interview overview reads.
export function linkedinCheckText(check: LinkedinCheck): string {
  return `LinkedIn check by ${check.checkedBy}: ${LINKEDIN_OUTCOME_LABEL[check.outcome]}.${check.note ? ` ${check.note}` : ""} (${check.url})`;
}
