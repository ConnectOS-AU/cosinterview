"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ACT_AS_COOKIE, requireAdmin } from "@/lib/staff/auth";
import { createRecruiter, findRecruiterById, setRecruiterAccess } from "@/lib/staff/repo";
import { safeNextPath } from "@/lib/staff/session";

export type AddRecruiterState = { ok: boolean; message: string } | null;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function addRecruiter(_prev: AddRecruiterState, form: FormData): Promise<AddRecruiterState> {
  await requireAdmin();
  const displayName = String(form.get("displayName") ?? "").trim().slice(0, 80);
  const email = String(form.get("email") ?? "").trim().slice(0, 200);
  const title = String(form.get("title") ?? "").trim().slice(0, 80) || null;
  if (!displayName) return { ok: false, message: "Enter their name." };
  if (!EMAIL.test(email)) return { ok: false, message: "Enter their Microsoft (Outlook) email address." };

  const result = await createRecruiter({ displayName, email, title, isAdmin: form.get("isAdmin") === "on" });
  if (result === "email_taken") return { ok: false, message: "There's already a recruiter with that email." };
  revalidatePath("/r/admin");
  return { ok: true, message: `${displayName} added. They can sign in now and fill in their profile.` };
}

export async function setAccess(recruiterId: string, field: "active" | "isAdmin", value: boolean): Promise<{ error?: string }> {
  const { own } = await requireAdmin();
  if (recruiterId === own.id && !value) {
    return { error: field === "active" ? "You can't deactivate yourself." : "You can't remove your own admin access." };
  }
  await setRecruiterAccess(recruiterId, { [field]: value });
  revalidatePath("/r", "layout");
  return {};
}

// Every recruiter screen then works as this recruiter until "Back to my account".
export async function workAs(recruiterId: string, next: string): Promise<void> {
  const { own } = await requireAdmin();
  const store = await cookies();
  if (recruiterId === own.id) {
    store.delete({ name: ACT_AS_COOKIE, path: "/r" });
  } else {
    if (!(await findRecruiterById(recruiterId))) throw new Error("That recruiter isn't active.");
    // Session-only, and only sent to the recruiter screens.
    store.set(ACT_AS_COOKIE, recruiterId, { path: "/r", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  }
  redirect(safeNextPath(next));
}

export async function stopWorkingAs(): Promise<void> {
  (await cookies()).delete({ name: ACT_AS_COOKIE, path: "/r" });
  redirect("/r/admin");
}
