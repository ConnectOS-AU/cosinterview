import "server-only";
import { demoInviteById, demoMode } from "./demo";
import { findInviteById } from "./repo";
import { GUEST_ROLE_LABEL, MAX_GUESTS, type GuestRole } from "./stages";
import { supabaseAdmin } from "./supabase/admin";
import { hashToken, looksLikeToken, newInviteToken } from "./tokens";
import type { InviteRecord } from "./types";

// Extra attendees invited by email: client attendees (client interviews) and
// "Other" people (any interview). Each gets a personal link to the attendee
// lobby (/g/<token>); only the token's hash is stored, like candidate invites.

export type Guest = { id: string; bookingId: string; email: string; name: string | null; role: GuestRole; invitedAt: string | null; createdAt: string };

type Row = { id: string; booking_id: string; email: string; name: string | null; role: GuestRole; invited_at: string | null; created_at: string };

const COLUMNS = "id, booking_id, email, name, role, invited_at, created_at";

const toGuest = (r: Row): Guest => ({
  id: r.id,
  bookingId: r.booking_id,
  email: r.email,
  name: r.name,
  role: r.role,
  invitedAt: r.invited_at,
  createdAt: r.created_at,
});

// Local demo store.
type DemoGuest = Guest & { tokenHash: string };
const demoGuests = ((globalThis as typeof globalThis & { __cosrecDemoGuests?: DemoGuest[] }).__cosrecDemoGuests ??= []);

export const guestDisplayName = (g: Pick<Guest, "name" | "email">) => g.name?.trim() || g.email;

export async function listGuests(bookingId: string): Promise<Guest[]> {
  if (demoMode()) return demoGuests.filter((g) => g.bookingId === bookingId);
  const { data, error } = await supabaseAdmin().from("cos_recruitment_guests").select(COLUMNS).eq("booking_id", bookingId).order("created_at");
  if (error) throw new Error(`Loading client attendees failed: ${error.message}`);
  return (data ?? []).map((r) => toGuest(r as Row));
}

// Adds one attendee and returns their link token (shown/emailed once).
export async function addGuest(
  bookingId: string,
  person: { email: string; name: string | null; role: GuestRole },
  createdBy: string,
): Promise<{ guest: Guest; token: string } | { error: string }> {
  const existing = await listGuests(bookingId);
  if (existing.filter((g) => g.role === person.role).length >= MAX_GUESTS[person.role]) {
    return { error: `Up to ${MAX_GUESTS[person.role]} ${GUEST_ROLE_LABEL[person.role].toLowerCase()} attendees per interview.` };
  }
  if (existing.some((g) => g.email.toLowerCase() === person.email.toLowerCase())) return { error: "That email is already invited." };

  const { token, hash } = newInviteToken();
  if (demoMode()) {
    const guest: DemoGuest = {
      id: crypto.randomUUID(),
      bookingId,
      email: person.email,
      name: person.name,
      role: person.role,
      invitedAt: null,
      createdAt: new Date().toISOString(),
      tokenHash: hash,
    };
    demoGuests.push(guest);
    return { guest, token };
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_guests")
    .insert({ booking_id: bookingId, email: person.email, name: person.name, role: person.role, token_hash: hash, created_by: createdBy })
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") return { error: "That email is already invited." };
    throw new Error(`Adding the client attendee failed: ${error.message}`);
  }
  return { guest: toGuest(data as Row), token };
}

// A new link for an attendee (the old one stops working).
export async function newGuestLink(bookingId: string, guestId: string): Promise<string | null> {
  const { token, hash } = newInviteToken();
  if (demoMode()) {
    const g = demoGuests.find((x) => x.id === guestId && x.bookingId === bookingId);
    if (!g) return null;
    g.tokenHash = hash;
    return token;
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_guests")
    .update({ token_hash: hash })
    .eq("id", guestId)
    .eq("booking_id", bookingId)
    .select("id");
  if (error) throw new Error(`New link failed: ${error.message}`);
  return data?.length ? token : null;
}

export async function markGuestInvited(guestId: string): Promise<void> {
  const now = new Date().toISOString();
  if (demoMode()) {
    const g = demoGuests.find((x) => x.id === guestId);
    if (g) g.invitedAt = now;
    return;
  }
  const { error } = await supabaseAdmin().from("cos_recruitment_guests").update({ invited_at: now }).eq("id", guestId);
  if (error) throw new Error(`Saving the invite failed: ${error.message}`);
}

export async function removeGuest(bookingId: string, guestId: string): Promise<void> {
  if (demoMode()) {
    const i = demoGuests.findIndex((g) => g.id === guestId && g.bookingId === bookingId);
    if (i >= 0) demoGuests.splice(i, 1);
    return;
  }
  const { error } = await supabaseAdmin().from("cos_recruitment_guests").delete().eq("id", guestId).eq("booking_id", bookingId);
  if (error) throw new Error(`Removing the client attendee failed: ${error.message}`);
}

// The client lobby: who this link belongs to and their interview.
export async function findGuestByToken(token: string): Promise<{ guest: Guest; invite: InviteRecord } | null> {
  if (!looksLikeToken(token)) return null;
  const hash = hashToken(token);
  if (demoMode()) {
    const g = demoGuests.find((x) => x.tokenHash === hash);
    const invite = g ? demoInviteById(g.bookingId) : null;
    return g && invite ? { guest: g, invite } : null;
  }
  const { data, error } = await supabaseAdmin().from("cos_recruitment_guests").select(COLUMNS).eq("token_hash", hash).maybeSingle();
  if (error) throw new Error(`Client link lookup failed: ${error.message}`);
  if (!data) return null;
  const invite = await findInviteById((data as Row).booking_id);
  return invite ? { guest: toGuest(data as Row), invite } : null;
}

// Which formatted resume client attendees see (a JobAdder attachment id); null
// means the newest formatted one.
const demoResumeChoice = ((globalThis as typeof globalThis & { __cosrecDemoResumeChoice?: Map<string, string | null> }).__cosrecDemoResumeChoice ??= new Map());

export async function clientResumeId(bookingId: string): Promise<string | null> {
  if (demoMode()) return demoResumeChoice.get(bookingId) ?? null;
  const { data, error } = await supabaseAdmin().from("cos_recruitment_bookings").select("client_resume_id").eq("id", bookingId).maybeSingle();
  if (error) throw new Error(`Loading the client resume choice failed: ${error.message}`);
  return (data as { client_resume_id: string | null } | null)?.client_resume_id ?? null;
}

export async function setClientResumeId(bookingId: string, attachmentId: string | null): Promise<void> {
  if (demoMode()) {
    demoResumeChoice.set(bookingId, attachmentId);
    return;
  }
  const { error } = await supabaseAdmin().from("cos_recruitment_bookings").update({ client_resume_id: attachmentId }).eq("id", bookingId);
  if (error) throw new Error(`Saving the client resume choice failed: ${error.message}`);
}
