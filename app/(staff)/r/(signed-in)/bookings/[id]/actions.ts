"use server";

import { revalidatePath } from "next/cache";
import { regenerateCandidateReview } from "@/lib/candidate-review";
import { createOwnerToken } from "@/lib/daily";
import { demoMode } from "@/lib/demo";
import { siteUrl } from "@/lib/invite";
import { addCandidateNote, jobAdderWriteConfigured } from "@/lib/staff/jobadder-api";
import { getInterviewRecord, markSummaryWritten } from "@/lib/staff/transcripts";
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
    // An admin working as this recruiter joins under their own name, still on the
    // recruiter side so the transcript labels them as the interviewer.
    const name = staff.actingAs && staff.own ? staff.own.displayName : staff.recruiter.displayName;
    const token = await createOwnerToken(room.name, { name, recruiterId: staff.recruiter.id });
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

// The recruiter reviews the summary, then sends it to the candidate's JobAdder
// record as an interview note. Never automatic.
export async function sendSummaryToJobAdder(bookingId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { invite } = await ownBooking(bookingId);
  const record = await getInterviewRecord(bookingId);
  if (!record.recordingId || !record.summary) return { ok: false, error: "There's no summary to send yet." };
  if (record.summary.writtenToJobAdderAt) return { ok: false, error: "Already added to JobAdder." };
  if (!demoMode() && !jobAdderWriteConfigured()) return { ok: false, error: "JobAdder write-back isn't set up yet." };

  const s = record.summary;
  const text = [
    `Video interview${invite.interview.jobTitle ? ` - ${invite.interview.jobTitle}` : ""} (COSInterview)`,
    "",
    s.summary,
    "",
    s.strengths.length ? `Strengths:\n${s.strengths.map((x) => `- ${x}`).join("\n")}` : "",
    s.concerns.length ? `Concerns:\n${s.concerns.map((x) => `- ${x}`).join("\n")}` : "",
    `Scores (1-5): communication ${s.scores.communication}, English ${s.scores.englishFluency}, experience ${s.scores.relevantExperience}, motivation ${s.scores.motivation}`,
    `Full transcript: ${siteUrl()}/r/bookings/${bookingId}`,
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");

  try {
    if (!demoMode()) await addCandidateNote(invite.jobadderCandidateId, text);
    await markSummaryWritten(record.recordingId);
    return { ok: true };
  } catch (err) {
    console.error("[jobadder note]", bookingId, err);
    return { ok: false, error: "JobAdder didn't accept the note. Please try again or paste it in manually." };
  }
}

// Candidate overview: write it again from the latest resume, notes and job
// description (also adds a fresh JobAdder note). Takes up to a minute or two.
export async function regenerateReview(bookingId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { invite } = await ownBooking(bookingId);
    if (invite.status === "invited" || invite.status === "cancelled") return { ok: false, error: "The candidate hasn't booked." };
    const result = await regenerateCandidateReview(invite);
    revalidatePath(`/r/bookings/${bookingId}/overview`);
    if (result === "skipped") return { ok: false, error: "The overview isn't set up on this server (no Anthropic API key)." };
    if (result === "failed") return { ok: false, error: "The overview couldn't be written - the details are on the page." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
