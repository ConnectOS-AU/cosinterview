import "server-only";
import { cache } from "react";
import { demoRecruiter, findRecruiterByEmail, isActiveStaff, type RecruiterProfile } from "./repo";
import { createSessionClient, isDemoStaff } from "./session";

export type Staff = {
  userId: string;
  email: string;
  name: string;
  // Null when the signed-in person has no recruiter profile yet.
  recruiter: RecruiterProfile | null;
};

// The signed-in ConnectOS staff member, or null if nobody is signed in or they
// aren't an active COSHub user. Cached per request.
export const getStaff = cache(async (): Promise<Staff | null> => {
  if (isDemoStaff()) {
    const recruiter = demoRecruiter();
    return { userId: "00000000-0000-0000-0000-000000000000", email: recruiter.calendarEmail, name: recruiter.displayName, recruiter };
  }

  const supabase = await createSessionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const email = typeof claims?.email === "string" ? claims.email : "";
  if (!email || typeof claims?.sub !== "string") return null;
  if (!(await isActiveStaff(email))) return null;

  const meta = (claims.user_metadata ?? {}) as { full_name?: string; name?: string };
  return {
    userId: claims.sub,
    email,
    name: meta.full_name || meta.name || email,
    recruiter: await findRecruiterByEmail(email),
  };
});

// For Server Actions: throws instead of returning null, so no action runs
// without a signed-in recruiter even if a route slips past the proxy.
export async function requireRecruiter(): Promise<Staff & { recruiter: RecruiterProfile }> {
  const staff = await getStaff();
  if (!staff) throw new Error("You need to sign in again.");
  if (!staff.recruiter) throw new Error("You don't have a recruiter profile yet.");
  return staff as Staff & { recruiter: RecruiterProfile };
}
