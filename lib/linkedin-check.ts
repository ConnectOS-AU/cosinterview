import "server-only";
import { demoMode } from "./demo";
import { supabaseAdmin } from "./supabase/admin";

// LinkedIn checks recruiters recorded by hand before the LinkedIn PDF comparison
// replaced them. No new ones are made; the old ones stay on the booking
// (cos_recruitment_bookings.linkedin_check) for the candidate overview.

export type LinkedinOutcome = "matches" | "differences" | "not_found";
export type LinkedinCheck = { url: string; outcome: LinkedinOutcome; note: string | null; checkedBy: string; checkedAt: string };

export const LINKEDIN_OUTCOME_LABEL: Record<LinkedinOutcome, string> = {
  matches: "Matches the resume",
  differences: "Differences from the resume",
  not_found: "Profile couldn't be found or opened",
};

const store = globalThis as typeof globalThis & { __cosrecLinkedin?: Map<string, LinkedinCheck> };

export async function getLinkedinCheck(bookingId: string): Promise<LinkedinCheck | null> {
  if (demoMode()) return store.__cosrecLinkedin?.get(bookingId) ?? null;
  const { data, error } = await supabaseAdmin().from("cos_recruitment_bookings").select("linkedin_check").eq("id", bookingId).maybeSingle();
  if (error) throw new Error(`Reading the LinkedIn check failed: ${error.message}`);
  return (data?.linkedin_check as LinkedinCheck | null) ?? null;
}

// The line the post-interview overview reads.
export function linkedinCheckText(check: LinkedinCheck): string {
  return `LinkedIn check by ${check.checkedBy}: ${LINKEDIN_OUTCOME_LABEL[check.outcome]}.${check.note ? ` ${check.note}` : ""} (${check.url})`;
}
