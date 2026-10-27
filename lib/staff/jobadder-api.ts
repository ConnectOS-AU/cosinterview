import "server-only";
import { supabaseAdmin } from "../supabase/admin";

// Writes back to JobAdder. Reuses the OAuth token the existing JobAdder sync
// keeps in ja_token, refreshing it only if it has expired.
//
// UNVERIFIED: the note endpoint and body below follow JobAdder's v2 candidate
// notes resource but haven't been tried against the live account - test with
// one candidate before relying on it (see README go-live checklist).

const API = (process.env.JOBADDER_API_URL || "https://api.jobadder.com/v2").replace(/\/$/, "");
const NOTE_TYPE = process.env.JOBADDER_NOTE_TYPE || "Internal interview";

export function jobAdderWriteConfigured(): boolean {
  return Boolean(process.env.JOBADDER_CLIENT_ID && process.env.JOBADDER_CLIENT_SECRET);
}

type TokenRow = { id: number; access_token: string; refresh_token: string; expires_at: string };

async function accessToken(): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("ja_token").select("id, access_token, refresh_token, expires_at").limit(1).single();
  if (error) throw new Error(`JobAdder token lookup failed: ${error.message}`);
  const row = data as TokenRow;
  if (new Date(row.expires_at).getTime() > Date.now() + 2 * 60_000) return row.access_token;

  const res = await fetch("https://id.jobadder.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.JOBADDER_CLIENT_ID!,
      client_secret: process.env.JOBADDER_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`JobAdder token refresh failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  // Only write back if the sync hasn't refreshed it in the meantime.
  await db
    .from("ja_token")
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? row.refresh_token,
      expires_at: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    })
    .eq("id", row.id)
    .eq("refresh_token", row.refresh_token);
  return json.access_token;
}

export async function addCandidateNote(candidateId: string, text: string): Promise<void> {
  const res = await fetch(`${API}/candidates/${encodeURIComponent(candidateId)}/notes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ type: NOTE_TYPE, text }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`JobAdder note failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
}
