import "server-only";
import { demoMode } from "./demo";
import { supabaseAdmin } from "./supabase/admin";

// Who joined each interview call: the recruiter (and anyone joining on the
// recruiter's side), the candidate, client attendees and others. Recorded from the
// recruiter's screen as people come into the call; each person once.

export type AttendeeKind = "recruiter" | "candidate" | "client" | "other";
export type Attendee = { name: string; kind: AttendeeKind; joinedAt: string };

const demoAttendees = ((globalThis as typeof globalThis & { __cosrecDemoAttendees?: Map<string, Attendee[]> }).__cosrecDemoAttendees ??= new Map<string, Attendee[]>());

export async function recordAttendee(bookingId: string, person: { name: string; kind: AttendeeKind }): Promise<void> {
  const name = person.name.trim().slice(0, 200);
  if (!name) return;
  if (demoMode()) {
    const list = demoAttendees.get(bookingId) ?? [];
    if (!list.some((a) => a.kind === person.kind && a.name === name)) list.push({ name, kind: person.kind, joinedAt: new Date().toISOString() });
    demoAttendees.set(bookingId, list);
    return;
  }
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_attendees")
    .upsert({ booking_id: bookingId, name, kind: person.kind }, { onConflict: "booking_id,kind,name", ignoreDuplicates: true });
  if (error) console.error("[attendance]", bookingId, error.message);
}

const ORDER: AttendeeKind[] = ["recruiter", "candidate", "client", "other"];

export async function listAttendees(bookingId: string): Promise<Attendee[]> {
  let list: Attendee[];
  if (demoMode()) {
    list = [...(demoAttendees.get(bookingId) ?? [])];
  } else {
    const { data, error } = await supabaseAdmin().from("cos_recruitment_attendees").select("name, kind, joined_at").eq("booking_id", bookingId);
    if (error) throw new Error(`Loading attendance failed: ${error.message}`);
    list = (data ?? []).map((r) => ({ name: r.name as string, kind: r.kind as AttendeeKind, joinedAt: r.joined_at as string }));
  }
  return list.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.joinedAt.localeCompare(b.joinedAt));
}

const KIND_LABEL: Record<AttendeeKind, string> = { recruiter: "recruiter", candidate: "candidate", client: "client", other: "other" };

// "Attended: Rei Agustin (recruiter), Juan dela Cruz (candidate), Jane Smith (client)"
export function attendanceLine(attendees: Attendee[]): string {
  return attendees.length ? `Attended: ${attendees.map((a) => `${a.name} (${KIND_LABEL[a.kind]})`).join(", ")}` : "Attended: no one joined the video call";
}
