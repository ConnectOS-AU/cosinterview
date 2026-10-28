import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { demoMode } from "../demo";

// One sign-in shared with COSHub. Both apps use the same Supabase project, so a
// session from either is valid in both; with AUTH_COOKIE_DOMAIN=.connectos.co
// the cookie is saved for every connectos.co subdomain instead of just this
// one. COSHub must use the same name and domain. The name differs from
// Supabase's default so older host-only cookies are ignored, not mixed in.
// Unset (local dev), each app keeps its own cookie.
export const authCookieOptions = process.env.AUTH_COOKIE_DOMAIN
  ? { name: "cos-auth", domain: process.env.AUTH_COOKIE_DOMAIN }
  : undefined;

// Supabase Auth (Microsoft sign-in) for the recruiter screens, the same way
// COSHub does it - same Supabase project, so the same Entra users. Cookies are
// first-party to interviews.connectos.co, and because COSHub is on the same
// site (connectos.co) they still work when these pages are framed by COSHub.
export async function createSessionClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component - the proxy has already refreshed the session.
        }
      },
    },
  });
}

export function authConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

// Local dev without Supabase: sign in as the demo recruiter so the screens can
// be tried. Never in production.
export function isDemoStaff(): boolean {
  return demoMode();
}

// Only same-site paths, so a `next` value can't send someone to another origin.
export function safeNextPath(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/r";
}

export const NEXT_COOKIE = "cosrec_next";
