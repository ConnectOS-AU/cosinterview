import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions, expireOldAuthCookies } from "./lib/staff/session";

// Sign-in gate for the recruiter screens (/r). Refreshes the Supabase session
// cookie on every request and sends anyone without a session to /r/login.
// Pages and actions check again (getStaff / requireRecruiter), including the
// COSHub "active user" rule - this isn't the only check.
// Candidate pages (/c) are public and never touched here.

const PUBLIC_STAFF_PATHS = ["/r/login", "/r/auth/"];

export async function proxy(request: NextRequest) {
  return expireOldAuthCookies(request, await gate(request));
}

async function gate(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_STAFF_PATHS.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))) {
    return NextResponse.next();
  }
  // Local dev without Supabase uses the demo recruiter (see lib/staff/session.ts).
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return process.env.NODE_ENV === "production" ? new NextResponse("Not configured", { status: 503 }) : NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Verifies the JWT and refreshes an expired session - keep this first.
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.email === "string" && data.claims.email) return response;

  const url = new URL("/r/login", process.env.NEXT_PUBLIC_SITE_URL || request.url);
  if (pathname !== "/r") url.searchParams.set("next", pathname + search);
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export const config = {
  matcher: ["/r", "/r/:path*"],
};
