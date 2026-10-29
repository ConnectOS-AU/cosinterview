"use server";

import { DateTime } from "luxon";
import { headers } from "next/headers";
import { demoMode } from "@/lib/demo";
import { findGuestByToken, guestDisplayName } from "@/lib/guests";
import { joinWindow } from "@/lib/invite";
import { allowRequest } from "@/lib/rate-limit";
import { roomForBooking } from "@/lib/rooms";
import { logToJobAdder } from "@/lib/staff/jobadder-api";
import { addNote, deleteNote, listNotes } from "@/lib/staff/repo";
import { guestCallName, noteLine, stagePrefix } from "@/lib/stages";

// The client lobby's actions. Every one re-checks the attendee's personal link.

async function clientKey(action: string): Promise<string> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return `guest-${action}:${ip}`;
}

export type GuestRoomAccess =
  | { ok: true; roomUrl: string | null; userName: string; bookingId: string }
  | { ok: false; reason: "invalid" | "not_booked" | "too_early" | "closed" | "unavailable" };

// The room URL, only inside the join window. Like the candidate, the attendee
// has no meeting token, so Daily holds them in the lobby until the recruiter
// admits them; their name ends "(client)" or "(other)" so the recruiter's
// lobby list, attendance and the transcript can tell them from the candidate.
export async function getGuestRoomAccess(token: string): Promise<GuestRoomAccess> {
  if (!allowRequest(await clientKey("room"), 30, 60_000)) return { ok: false, reason: "unavailable" };
  const found = await findGuestByToken(token);
  if (!found) return { ok: false, reason: "invalid" };
  const { guest, invite } = found;
  if (invite.status !== "booked" && invite.status !== "in_progress") return { ok: false, reason: invite.status === "invited" ? "not_booked" : "closed" };
  const window = joinWindow(invite);
  if (!window) return { ok: false, reason: "not_booked" };
  const now = DateTime.utc();
  if (!demoMode()) {
    if (now < window.opens) return { ok: false, reason: "too_early" };
    if (now > window.closes) return { ok: false, reason: "closed" };
  }
  try {
    const room = await roomForBooking(invite);
    return { ok: true, roomUrl: room?.url ?? null, userName: guestCallName(guestDisplayName(guest), guest.role), bookingId: invite.bookingId };
  } catch (err) {
    console.error("[guest room] Daily room setup failed", invite.bookingId, err);
    return { ok: false, reason: "unavailable" };
  }
}

export type GuestNote = { id: string; body: string; createdAt: string };

async function guestFor(token: string) {
  const found = await findGuestByToken(token);
  if (!found || found.invite.status === "cancelled") throw new Error("This link isn't valid.");
  return found;
}

// Attendees see only their own notes (the recruiter sees everyone's).
export async function loadGuestNotes(token: string): Promise<GuestNote[]> {
  const { guest, invite } = await guestFor(token);
  return (await listNotes(invite.bookingId))
    .filter((n) => n.authorKind !== "recruiter" && n.authorId === guest.id)
    .map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt }));
}

export async function saveGuestNote(token: string, body: string): Promise<GuestNote> {
  if (!allowRequest(await clientKey("note"), 60, 60_000)) throw new Error("Too many notes at once - please wait a moment.");
  const { guest, invite } = await guestFor(token);
  const text = body.trim().slice(0, 5000);
  if (!text) throw new Error("Note is empty.");
  const name = guestDisplayName(guest);
  const note = await addNote(invite.bookingId, { id: guest.id, name, kind: guest.role }, { body: text, offsetMs: null });
  // Notes written after the interview has finished missed the JobAdder note
  // that went with the rest, so each goes on its own.
  if (invite.status === "completed" || invite.status === "no_show") {
    await logToJobAdder(invite.jobadderCandidateId, noteLine(stagePrefix(invite.interview.stage, invite.slotStart), note));
  }
  return { id: note.id, body: note.body, createdAt: note.createdAt };
}

export async function removeGuestNote(token: string, noteId: string): Promise<void> {
  const { guest, invite } = await guestFor(token);
  if (invite.status === "completed" || invite.status === "no_show") throw new Error("Notes can't be removed once the interview has finished.");
  const note = (await listNotes(invite.bookingId)).find((n) => n.id === noteId);
  if (!note || note.authorKind === "recruiter" || note.authorId !== guest.id) throw new Error("Note not found.");
  await deleteNote(invite.bookingId, noteId);
}
