import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Supabase Auth (Microsoft sign-in) for the recruiter screens, the same way
// COSHub does it - same Supabase project, so the same Entra users. Cookies are
// first-party to interviews.connectos.co, and because COSHub is on the same
// site (connectos.co) they still work when these pages are framed by COSHub.
export async function createSessionClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
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
  return process.env.NODE_ENV !== "production" && !authConfigured();
}

// Only same-site paths, so a `next` value can't send someone to another origin.
export function safeNextPath(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/r";
}

export const NEXT_COOKIE = "cosrec_next";
