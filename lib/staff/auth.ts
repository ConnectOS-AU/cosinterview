import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { demoRecruiter, findRecruiterByEmail, findRecruiterById, isActiveStaff, type RecruiterProfile } from "./repo";
import { createSessionClient, isDemoStaff } from "./session";

export type Staff = {
  userId: string;
  email: string;
  name: string;
  // The recruiter every screen works as: the person's own profile, or the one
  // an admin chose with "Work as". Null when they have no profile yet.
  recruiter: RecruiterProfile | null;
  // The signed-in person's own profile (differs from recruiter while working as someone else).
  own: RecruiterProfile | null;
  actingAs: boolean;
};

// Set by an admin's "Work as" (app/(staff)/r/(signed-in)/admin/actions.ts):
// the id of the recruiter they're working as. Ignored for anyone who isn't an admin.
export const ACT_AS_COOKIE = "cosrec_act_as";

// The signed-in ConnectOS staff member, or null if nobody is signed in or they
// aren't an active COSHub user. Cached per request.
export const getStaff = cache(async (): Promise<Staff | null> => {
  let base: Omit<Staff, "recruiter" | "actingAs">;
  if (isDemoStaff()) {
    const own = demoRecruiter();
    base = { userId: "00000000-0000-0000-0000-000000000000", email: own.calendarEmail, name: own.displayName, own };
  } else {
    const supabase = await createSessionClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    const email = typeof claims?.email === "string" ? claims.email : "";
    if (!email || typeof claims?.sub !== "string") return null;
    if (!(await isActiveStaff(email))) return null;

    const meta = (claims.user_metadata ?? {}) as { full_name?: string; name?: string };
    base = { userId: claims.sub, email, name: meta.full_name || meta.name || email, own: await findRecruiterByEmail(email) };
  }

  const actAsId = (await cookies()).get(ACT_AS_COOKIE)?.value;
  if (base.own?.isAdmin && actAsId && actAsId !== base.own.id) {
    const other = await findRecruiterById(actAsId);
    if (other) return { ...base, recruiter: other, actingAs: true };
  }
  return { ...base, recruiter: base.own, actingAs: false };
});

// For Server Actions: throws instead of returning null, so no action runs
// without a signed-in recruiter even if a route slips past the proxy.
export async function requireRecruiter(): Promise<Staff & { recruiter: RecruiterProfile }> {
  const staff = await getStaff();
  if (!staff) throw new Error("You need to sign in again.");
  if (!staff.recruiter) throw new Error("You don't have a recruiter profile yet.");
  return staff as Staff & { recruiter: RecruiterProfile };
}

// For the admin page and its actions: the person's own profile must be an
// admin's, whoever they're working as.
export async function requireAdmin(): Promise<Staff & { own: RecruiterProfile }> {
  const staff = await getStaff();
  if (!staff) throw new Error("You need to sign in again.");
  if (!staff.own?.isAdmin) throw new Error("Only admins can manage recruiters.");
  return staff as Staff & { own: RecruiterProfile };
}
