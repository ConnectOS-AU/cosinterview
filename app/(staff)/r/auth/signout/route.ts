import { NextResponse } from "next/server";
import { siteUrl } from "@/lib/invite";
import { createSessionClient } from "@/lib/staff/session";

export async function POST() {
  const supabase = await createSessionClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/r/login", siteUrl()), { status: 303 });
}
