"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { attendanceLine, listAttendees, recordAttendee } from "@/lib/attendance";
import { isClientStage, noteLine, parseCallName, stageLabel, stagePrefix, type GuestRole } from "@/lib/stages";
import { formatSlot, guestInviteEmail } from "@/lib/emails";
import { addGuest, clientResumeId, guestDisplayName, listGuests, markGuestInvited, newGuestLink, removeGuest, setClientResumeId, type Guest } from "@/lib/guests";
import { getJobDescription } from "@/lib/job-description";
import { downloadResumeVersion, listResumeVersions, versionForClient } from "@/lib/resumes";
import { sendCandidateMail, type MailAttachment } from "@/lib/mail";
import { htmlToText } from "@/lib/review-inputs";
import { runDebrief } from "@/lib/candidate-debrief";
import { getLinkedinCheck, linkedinCheckText, linkedinUrlFor, saveLinkedinCheck, type LinkedinCheck, type LinkedinOutcome } from "@/lib/linkedin-check";
import { regenerateCandidateReview } from "@/lib/candidate-review";
import { createOwnerToken } from "@/lib/daily";
import { demoMode } from "@/lib/demo";
import { siteUrl } from "@/lib/invite";
import { addCandidateNote, jobAdderWriteConfigured, logToJobAdder } from "@/lib/staff/jobadder-api";
import { getInterviewRecord, markSummaryWritten } from "@/lib/staff/transcripts";
import { findInviteById } from "@/lib/repo";
import { roomForBooking } from "@/lib/rooms";
import { requireRecruiter } from "@/lib/staff/auth";
import {
  addNote,
  deleteNote,
  listNotes,
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
    // The LinkedIn check is mandatory when there's a profile to check.
    if (!(await getLinkedinCheck(bookingId)) && (await linkedinUrlFor(invite))) {
      return { ok: false, error: "Record the LinkedIn check before joining." };
    }
    const room = await roomForBooking(invite);
    if (!room) return { ok: true, roomUrl: null, token: null };
    // An admin working as this recruiter joins under their own name, still on the
    // recruiter side so the transcript labels them as the interviewer.
    const name = staff.actingAs && staff.own ? staff.own.displayName : staff.recruiter.displayName;
    const token = await createOwnerToken(room.name, { name, recruiterId: staff.recruiter.id });
    await recordAttendee(bookingId, { name, kind: "recruiter" });
    return { ok: true, roomUrl: room.url, token };
  } catch (err) {
    console.error("[recruiter join]", bookingId, err);
    return { ok: false, error: "Couldn't open the interview room. Please try again." };
  }
}

// The recruiter's comparison of the candidate's LinkedIn profile with their
// resume, required before joining when there's a profile. Added to JobAdder.
export async function recordLinkedinCheck(
  bookingId: string,
  outcome: LinkedinOutcome,
  note: string,
): Promise<{ ok: true; check: LinkedinCheck } | { ok: false; error: string }> {
  try {
    const { staff, invite } = await ownBooking(bookingId);
    const url = await linkedinUrlFor(invite);
    if (!url) return { ok: false, error: "There's no LinkedIn profile to check for this candidate." };
    if (outcome !== "matches" && outcome !== "differences" && outcome !== "not_found") return { ok: false, error: "Choose what you found." };
    const text = note.trim().slice(0, 1000) || null;
    if (outcome !== "matches" && !text) {
      return { ok: false, error: outcome === "differences" ? "Say what's different." : "Say what happened when you tried to open it." };
    }
    const name = staff.actingAs && staff.own ? staff.own.displayName : staff.recruiter.displayName;
    const check: LinkedinCheck = { url, outcome, note: text, checkedBy: name, checkedAt: new Date().toISOString() };
    await saveLinkedinCheck(bookingId, check);
    after(() => logToJobAdder(invite.jobadderCandidateId, `${stagePrefix(invite.interview.stage, invite.slotStart)} ${linkedinCheckText(check)}`));
    return { ok: true, check };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function saveNote(bookingId: string, body: string, offsetMs: number | null): Promise<InterviewNote> {
  const { staff } = await ownBooking(bookingId);
  const text = body.trim().slice(0, 5000);
  if (!text) throw new Error("Note is empty.");
  // An admin working as this recruiter writes under their own name.
  const name = staff.actingAs && staff.own ? staff.own.displayName : staff.recruiter.displayName;
  return addNote(
    bookingId,
    { id: staff.userId, name, kind: "recruiter" },
    { body: text, offsetMs: offsetMs === null ? null : Math.max(0, Math.round(offsetMs)) },
  );
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
  const { invite } = await ownBooking(bookingId);
  await setBookingStatus(bookingId, outcome);
  // The local demo has no recordings: write its sample post-interview overview now.
  if (demoMode() && outcome === "completed") await runDebrief(invite);
  // Who attended and everyone's notes (recruiter and client attendees) go to
  // the candidate's JobAdder record, each with the stage and date in front.
  after(async () => {
    const [notes, attendees] = await Promise.all([listNotes(bookingId), listAttendees(bookingId)]);
    const prefix = stagePrefix(invite.interview.stage, invite.slotStart);
    const heading = `${stageLabel(invite.interview.stage)} notes${invite.interview.jobTitle ? ` - ${invite.interview.jobTitle}` : ""} (COSInterview)${outcome === "no_show" ? " - candidate didn't attend" : ""}`;
    await logToJobAdder(
      invite.jobadderCandidateId,
      [heading, `${prefix} ${attendanceLine(attendees)}`, ...(notes.length ? ["", ...notes.map((n) => noteLine(prefix, n))] : [])].join("\n"),
    );
  });
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
    `${stagePrefix(invite.interview.stage, invite.slotStart)} Video interview summary${invite.interview.jobTitle ? ` - ${invite.interview.jobTitle}` : ""} (COSInterview)`,
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

// The notes so far, so the recruiter sees client attendees' notes as they come in.
export async function loadNotes(bookingId: string): Promise<InterviewNote[]> {
  await ownBooking(bookingId);
  return listNotes(bookingId);
}

// Extra attendees: up to 5 client attendees (client interviews only) and up
// to 5 others (any interview), invited by email, each with a personal link to
// the attendee lobby.

export type GuestResult = { ok: true; guests: Guest[]; link?: string; emailed?: boolean } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const guestLink = (token: string) => `${siteUrl()}/g/${token}`;

async function ownOpenBooking(bookingId: string) {
  const own = await ownBooking(bookingId);
  if (own.invite.status === "cancelled" || own.invite.status === "completed") throw new Error("This interview is closed.");
  return own;
}

const RESUME_TYPE = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", text: "text/plain" } as const;

// The formatted resume attendees may see (never an original), as an email
// attachment. Null when there's none yet or it couldn't be downloaded - the
// email then says it'll be in their waiting room.
async function clientResumeAttachment(invite: Awaited<ReturnType<typeof ownBooking>>["invite"]): Promise<MailAttachment | null> {
  const [{ versions }, chosen] = await Promise.all([listResumeVersions(invite.jobadderCandidateId), clientResumeId(invite.bookingId)]);
  const version = versionForClient(versions, chosen);
  if (!version) return null;
  if (demoMode()) return { filename: version.fileName, contentType: RESUME_TYPE.pdf, content: Buffer.from("%PDF-demo") };
  try {
    const file = await downloadResumeVersion(invite.jobadderCandidateId, version);
    if (!file.format) return null;
    const ext = { pdf: ".pdf", docx: ".docx", text: ".txt" }[file.format];
    const base = `${invite.candidateName} - resume`.replace(/[^\w. -]/g, "_");
    return { filename: `${base}${ext}`, contentType: RESUME_TYPE[file.format], content: file.bytes };
  } catch (err) {
    console.error("[guest email] Resume download failed", invite.bookingId, err);
    return null;
  }
}

// Emails the attendee their link in the recruiter's name, with the formatted
// resume attached and the job description. Returns whether it went.
async function emailGuest(invite: Awaited<ReturnType<typeof ownBooking>>["invite"], guest: Guest, link: string): Promise<boolean> {
  const [resume, jobHtml] = await Promise.all([
    clientResumeAttachment(invite),
    getJobDescription(invite.interview.jobadderJobId).catch((err) => {
      console.error("[guest email] Job description failed", invite.bookingId, err);
      return null;
    }),
  ]);
  const content = await guestInviteEmail({
    guestName: guest.name,
    candidateName: invite.candidateName,
    jobTitle: invite.interview.jobTitle,
    stage: stageLabel(invite.interview.stage),
    when: invite.slotStart && invite.slotEnd ? formatSlot(invite.slotStart, invite.slotEnd, invite.recruiter.timezone) : null,
    link,
    resumeAttached: Boolean(resume),
    jobDescription: jobHtml ? { html: jobHtml, text: htmlToText(jobHtml.replace(/<li[^>]*>/gi, "$&- ")) } : null,
    recruiterName: invite.recruiter.displayName,
    recruiterTitle: invite.recruiter.title,
  });
  try {
    await sendCandidateMail({
      to: { name: guestDisplayName(guest), email: guest.email },
      recruiter: { name: invite.recruiter.displayName, email: invite.recruiter.calendarEmail },
      subject: content.subject,
      html: content.bodyHtml,
      text: content.text,
      ...(resume && { attachments: [resume] }),
    });
    await markGuestInvited(guest.id);
    return true;
  } catch (err) {
    console.error("[guest email]", guest.email, err);
    return false;
  }
}

export async function inviteGuest(bookingId: string, email: string, name: string, role: GuestRole, send: boolean): Promise<GuestResult> {
  try {
    const { staff, invite } = await ownOpenBooking(bookingId);
    if (role !== "client" && role !== "other") return { ok: false, error: "Choose Client or Other." };
    if (role === "client" && !isClientStage(invite.interview.stage)) return { ok: false, error: "Client attendees are only for client interviews." };
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address) || address.length > 254) return { ok: false, error: "Enter a valid email address." };
    const added = await addGuest(bookingId, { email: address, name: name.trim().slice(0, 120) || null, role }, staff.userId);
    if ("error" in added) return { ok: false, error: added.error };
    const link = guestLink(added.token);
    const emailed = send ? await emailGuest(invite, added.guest, link) : false;
    return { ok: true, guests: await listGuests(bookingId), link, emailed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

// A new link (the old one stops working), emailed again if asked.
export async function resendGuest(bookingId: string, guestId: string, send: boolean): Promise<GuestResult> {
  try {
    const { invite } = await ownOpenBooking(bookingId);
    const guest = (await listGuests(bookingId)).find((g) => g.id === guestId);
    const token = guest ? await newGuestLink(bookingId, guestId) : null;
    if (!guest || !token) return { ok: false, error: "That attendee isn't on this interview." };
    const link = guestLink(token);
    const emailed = send ? await emailGuest(invite, guest, link) : false;
    return { ok: true, guests: await listGuests(bookingId), link, emailed };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function uninviteGuest(bookingId: string, guestId: string): Promise<GuestResult> {
  try {
    await ownBooking(bookingId);
    await removeGuest(bookingId, guestId);
    return { ok: true, guests: await listGuests(bookingId) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

// Which formatted resume client attendees see (null: the newest).
export async function chooseClientResume(bookingId: string, attachmentId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { invite } = await ownOpenBooking(bookingId);
    if (attachmentId) {
      const { versions } = await listResumeVersions(invite.jobadderCandidateId);
      if (!versions.some((v) => v.id === attachmentId && v.formatted)) return { ok: false, error: "Attendees can only be shown a formatted resume." };
    }
    await setClientResumeId(bookingId, attachmentId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

// Someone came into the call (seen from the recruiter's screen). Extra
// attendees join as "<name> (client)" / "<name> (other)"; anyone else admitted
// is the candidate.
export async function noteAttendee(bookingId: string, displayName: string): Promise<void> {
  const { invite } = await ownBooking(bookingId);
  const { name, role } = parseCallName(displayName.trim());
  await recordAttendee(bookingId, role ? { name, kind: role } : { name: name || invite.candidateName, kind: "candidate" });
}

// The candidate overview after the interview: write it again from the
// transcript (takes a minute or two).
export async function regenerateDebrief(bookingId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { invite } = await ownBooking(bookingId);
    if (invite.status !== "completed") return { ok: false, error: "The interview hasn't finished." };
    const result = await runDebrief(invite);
    revalidatePath(`/r/bookings/${bookingId}/overview`);
    if (result === "skipped") return { ok: false, error: "There's no transcript yet, or the AI isn't set up on this server." };
    if (result === "failed") return { ok: false, error: "It couldn't be written - the details are on the page." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
