"use server";

import { createOwnerToken } from "@/lib/daily";
import { findInviteById } from "@/lib/repo";
import { roomForBooking } from "@/lib/rooms";
import { requireRecruiter } from "@/lib/staff/auth";
import {
  addNote,
  deleteNote,
  recordRecordingStarted,
  setBookingStatus,
  type InterviewNote,
} from "@/lib/staff/repo";

// Every action re-checks that the signed-in recruiter owns this booking.
async function ownBooking(bookingId: string) {
  const staff = await requireRecruiter();
  const invite = await findInviteById(bookingId);
  if (!invite || invite.recruiter.id !== staff.recruiter.id) throw new Error("Interview not found.");
  return { staff, invite };
}

export type JoinResult =
  | { ok: true; roomUrl: string; token: string }
  | { ok: true; roomUrl: null; token: null } // local dev without Daily
  | { ok: false; error: string };

export async function joinAsRecruiter(bookingId: string): Promise<JoinResult> {
  try {
    const { staff, invite } = await ownBooking(bookingId);
    if (invite.status !== "booked" && invite.status !== "in_progress") {
      return { ok: false, error: "This interview isn't booked." };
    }
    const room = await roomForBooking(invite);
    if (!room) return { ok: true, roomUrl: null, token: null };
    const token = await createOwnerToken(room.name, { name: staff.recruiter.displayName, recruiterId: staff.recruiter.id });
    return { ok: true, roomUrl: room.url, token };
  } catch (err) {
    console.error("[recruiter join]", bookingId, err);
    return { ok: false, error: "Couldn't open the interview room. Please try again." };
  }
}

export async function saveNote(bookingId: string, body: string, offsetMs: number | null): Promise<InterviewNote> {
  const { staff } = await ownBooking(bookingId);
  const text = body.trim().slice(0, 5000);
  if (!text) throw new Error("Note is empty.");
  return addNote(bookingId, staff.userId, { body: text, offsetMs: offsetMs === null ? null : Math.max(0, Math.round(offsetMs)) });
}

export async function removeNote(bookingId: string, noteId: string): Promise<void> {
  await ownBooking(bookingId);
  await deleteNote(bookingId, noteId);
}

export async function recordingStarted(bookingId: string, dailyRecordingId: string | null): Promise<void> {
  await ownBooking(bookingId);
  await setBookingStatus(bookingId, "in_progress");
  if (dailyRecordingId) await recordRecordingStarted(bookingId, dailyRecordingId);
}

export async function finishInterview(bookingId: string, outcome: "completed" | "no_show"): Promise<void> {
  await ownBooking(bookingId);
  await setBookingStatus(bookingId, outcome);
}
