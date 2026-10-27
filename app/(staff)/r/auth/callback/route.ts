import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { siteUrl } from "@/lib/invite";
import { isActiveStaff } from "@/lib/staff/repo";
import { createSessionClient, NEXT_COOKIE, safeNextPath } from "@/lib/staff/session";

// Microsoft -> Supabase -> here. Swaps the code for a session, then applies
// COSHub's rule: only people SCIM has provisioned (assigned to COSHub in Entra).
export async function GET(request: NextRequest) {
  const fail = (message: string) => {
    const url = new URL("/r/login", siteUrl());
    url.searchParams.set("error", message);
    return NextResponse.redirect(url);
  };

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return fail(request.nextUrl.searchParams.get("error_description") ?? "Microsoft sign-in failed. Please try again.");
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return fail(error?.message ?? "Microsoft sign-in failed. Please try again.");

  if (!data.user.email || !(await isActiveStaff(data.user.email))) {
    await supabase.auth.signOut();
    return fail("Your Microsoft account isn't set up for COSHub. Ask IT to assign you to the COSHub app.");
  }

  const cookieStore = await cookies();
  const next = safeNextPath(cookieStore.get(NEXT_COOKIE)?.value);
  cookieStore.delete(NEXT_COOKIE);
  const done = new URL("/r/auth/done", siteUrl());
  done.searchParams.set("next", next);
  return NextResponse.redirect(done);
}
