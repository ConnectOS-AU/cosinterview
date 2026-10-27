import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { siteUrl } from "@/lib/invite";
import { createSessionClient, NEXT_COOKIE, safeNextPath } from "@/lib/staff/session";

// Starts Microsoft sign-in (via Supabase Auth, the same Azure provider COSHub
// uses). The callback URL must be in Supabase's redirect allow list.
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.set(NEXT_COOKIE, safeNextPath(request.nextUrl.searchParams.get("next")), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
  });

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    // Entra doesn't return an email without this scope, and Supabase Auth requires one.
    options: { redirectTo: `${siteUrl()}/r/auth/callback`, scopes: "email" },
  });
  if (error || !data.url) {
    const url = new URL("/r/login", siteUrl());
    url.searchParams.set("error", error?.message ?? "Couldn't start Microsoft sign-in.");
    return NextResponse.redirect(url);
  }
  return NextResponse.redirect(data.url);
}
