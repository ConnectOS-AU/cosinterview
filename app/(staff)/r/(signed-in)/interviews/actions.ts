"use server";

import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { cancellationEmail, type EmailContent, formatSlot, inviteEmail } from "@/lib/emails";
import { deleteInterviewEvent, graphConfigured } from "@/lib/graph";
import { siteUrl } from "@/lib/invite";
import { mailConfigured, mailForNote, sendCandidateMail } from "@/lib/mail";
import { findInviteById, releaseBooking } from "@/lib/repo";
import { requireRecruiter } from "@/lib/staff/auth";
import { INTERVIEW_LENGTHS } from "@/lib/staff/options";
import { getJob, listApplications } from "@/lib/staff/jobadder";
import { logToJobAdder } from "@/lib/staff/jobadder-api";
import { createInvites, openInterviewFor, replaceInviteToken, stagesForJob } from "@/lib/staff/repo";
import { isStage, stageLabel, type Stage } from "@/lib/stages";
import { newInviteToken } from "@/lib/tokens";
import type { InviteRecord, NewInvite, RecruiterProfile } from "@/lib/types";

const INVITE_DAYS = 14;
const MAX_PER_BATCH = 50;
const MAX_MESSAGE = 1000;

const inviteExpiry = (iso: string) => DateTime.fromISO(iso).setZone("Asia/Manila").toFormat("d LLLL yyyy");

export type SentInvite = {
  name: string;
  email: string;
  link: string;
  emailed: boolean;
  error?: string;
};

export type CreateInvitesResult = { ok: true; sent: SentInvite[]; skipped: string[] } | { ok: false; error: string };

function linkFor(recruiter: Pick<RecruiterProfile, "slug">, token: string): string {
  return `${siteUrl()}/c/${recruiter.slug}/${token}`;
}

type Recruiter = Pick<RecruiterProfile, "displayName" | "calendarEmail">;

// Sends one email to a candidate in the recruiter's name. Returns the text for
// the JobAdder note, or null if it couldn't be sent.
async function sendToCandidate(recruiter: Recruiter, to: { name: string; email: string }, content: EmailContent): Promise<string | null> {
  const mail = { to, recruiter: { name: recruiter.displayName, email: recruiter.calendarEmail }, subject: content.subject, html: content.bodyHtml, text: content.text };
  try {
    await sendCandidateMail(mail);
    return mailForNote(mail);
  } catch (err) {
    console.error("[candidate email]", to.email, err);
    return null;
  }
}

// A JobAdder note: what happened, then the email the candidate got (if any).
const note = (summary: string, email: string | null) => (email ? `${summary}\n\n${email}` : summary);

const EMAIL_FAILED = "Email couldn't be sent - copy the link instead.";

function inviteContent(
  recruiter: RecruiterProfile,
  to: { name: string },
  details: { jobTitle: string | null; durationMins: number; link: string; expiresAt: string; reschedule?: boolean; message?: string | null },
): EmailContent {
  return inviteEmail({ candidateName: to.name, recruiterName: recruiter.displayName, recruiterTitle: recruiter.title, ...details });
}

// Creates (or reuses) the open interview for this job and invites the chosen
// candidates. Emails go out through SendGrid in the recruiter's name when it's
// set up; either way the links are returned so they can be copied.
export async function createInvitations(input: {
  jobId: string;
  durationMins: number;
  // Which interview this is (Screening, Interview 1, Client Interview 1, ...).
  stage: Stage;
  candidateIds: string[];
  sendEmail: boolean;
  // Optional personal note shown at the top of each invite email.
  message?: string;
}): Promise<CreateInvitesResult> {
  const staff = await requireRecruiter();
  const recruiter = staff.recruiter;
  if (!INTERVIEW_LENGTHS.includes(input.durationMins as (typeof INTERVIEW_LENGTHS)[number])) {
    return { ok: false, error: "Pick an interview length." };
  }
  if (!isStage(input.stage)) return { ok: false, error: "Pick which interview this is." };
  const ids = [...new Set(input.candidateIds)].slice(0, MAX_PER_BATCH);
  if (ids.length === 0) return { ok: false, error: "Select at least one candidate." };

  const job = await getJob(input.jobId);
  if (!job) return { ok: false, error: "That JobAdder job wasn't found." };

  // Only candidates who really applied to this job, have an email, and haven't
  // already been invited to (or done) this stage.
  const [applications, stages] = await Promise.all([listApplications(job.jobId), stagesForJob(job.jobId)]);
  const atStage = (id: string) => (stages.get(id) ?? []).some((s) => s.stage === input.stage);
  const byCandidate = new Map(applications.map((a) => [a.candidateId, a]));
  const skipped: string[] = [];
  const expiresAt = DateTime.utc().plus({ days: INVITE_DAYS }).endOf("day").toISO()!;
  const tokens = new Map<string, string>();
  const invites: NewInvite[] = [];
  for (const id of ids) {
    const app = byCandidate.get(id);
    if (!app) continue;
    if (!app.candidateEmail || atStage(id)) {
      skipped.push(app.candidateName);
      continue;
    }
    const { token, hash } = newInviteToken();
    tokens.set(id, token);
    invites.push({
      candidateId: id,
      applicationId: app.applicationId,
      name: app.candidateName,
      email: app.candidateEmail.trim(),
      tokenHash: hash,
      expiresAt,
    });
  }
  if (invites.length === 0) return { ok: true, sent: [], skipped };

  const interview = await openInterviewFor(recruiter, job, input.durationMins, staff.userId, input.stage);
  const created = await createInvites(recruiter, interview, invites);
  const canEmail = input.sendEmail && mailConfigured();
  const message = input.message?.trim().slice(0, MAX_MESSAGE) || null;

  const sent: SentInvite[] = [];
  const notes: { candidateId: string; text: string }[] = [];
  for (const invite of invites) {
    if (!created.has(invite.candidateId)) {
      skipped.push(invite.name);
      continue;
    }
    const link = linkFor(recruiter, tokens.get(invite.candidateId)!);
    const email = canEmail
      ? await sendToCandidate(recruiter, invite, inviteContent(recruiter, invite, { jobTitle: job.title, durationMins: input.durationMins, link, expiresAt, message }))
      : null;
    const failed = canEmail && !email;
    sent.push({ name: invite.name, email: invite.email, link, emailed: Boolean(email), error: failed ? EMAIL_FAILED : undefined });
    notes.push({
      candidateId: invite.candidateId,
      text: note(
        [
          `${stageLabel(input.stage)} invite ${email ? "emailed" : "link created"} via COSInterview for ${job.title}: ${input.durationMins}-minute video interview with ${recruiter.displayName}.`,
          `Waiting for the candidate to choose a time. The link works until ${inviteExpiry(expiresAt)}.`,
        ].join("\n"),
        email,
      ),
    });
  }

  // JobAdder: the invite went out (or the link was handed over to send).
  after(async () => {
    for (const n of notes) await logToJobAdder(n.candidateId, n.text);
  });

  revalidatePath("/r");
  return { ok: true, sent, skipped };
}

// --- Managing one booking -------------------------------------------------

async function ownBooking(bookingId: string): Promise<{ recruiter: RecruiterProfile; invite: InviteRecord }> {
  const { recruiter } = await requireRecruiter();
  const invite = await findInviteById(bookingId);
  if (!invite || invite.recruiter.id !== recruiter.id) throw new Error("Interview not found.");
  return { recruiter, invite };
}

async function removeOutlookEntry(invite: InviteRecord): Promise<void> {
  if (!invite.graphEventId || !graphConfigured()) return;
  try {
    await deleteInterviewEvent(invite.recruiter.calendarEmail, invite.graphEventId);
  } catch (err) {
    console.error("[cancel] Removing the Outlook entry failed", invite.bookingId, err);
  }
}

const bookedWhen = (invite: InviteRecord, zone: string) =>
  invite.slotStart && invite.slotEnd ? formatSlot(invite.slotStart, invite.slotEnd, zone) : null;

const candidateOf = (invite: InviteRecord) => ({ name: invite.candidateName, email: invite.candidateEmail });

export type LinkResult = { ok: true; link: string; emailed: boolean; error?: string } | { ok: false; error: string };

// New link for someone who hasn't booked yet (lost or expired email). The old
// link stops working.
export async function resendInvite(bookingId: string, sendEmail: boolean): Promise<LinkResult> {
  const { recruiter, invite } = await ownBooking(bookingId);
  if (invite.status !== "invited") return { ok: false, error: "This candidate has already booked." };
  const { token, hash } = newInviteToken();
  const expiresAt = DateTime.utc().plus({ days: INVITE_DAYS }).endOf("day").toISO()!;
  await replaceInviteToken(bookingId, hash, expiresAt);
  const link = linkFor(recruiter, token);
  const canEmail = sendEmail && mailConfigured();
  const email = canEmail
    ? await sendToCandidate(
        recruiter,
        candidateOf(invite),
        inviteContent(recruiter, candidateOf(invite), { jobTitle: invite.interview.jobTitle, durationMins: invite.interview.durationMins, link, expiresAt }),
      )
    : null;
  after(() =>
    logToJobAdder(
      invite.jobadderCandidateId,
      note(`New interview invite link ${email ? "emailed" : "created"} via COSInterview (works until ${inviteExpiry(expiresAt)}); the old link no longer works.`, email),
    ),
  );
  // No revalidatePath: the row would move sections and the new link would vanish
  // before it's copied. The list refreshes when the recruiter closes it.
  return { ok: true, link, emailed: Boolean(email), error: canEmail && !email ? EMAIL_FAILED : undefined };
}

// Frees the booked time and sends the candidate a fresh link to pick another.
export async function rescheduleBooking(bookingId: string, sendEmail: boolean): Promise<LinkResult> {
  const { recruiter, invite } = await ownBooking(bookingId);
  if (invite.status !== "booked") return { ok: false, error: "Only booked interviews that haven't started can be moved." };
  const was = bookedWhen(invite, recruiter.timezone);
  await removeOutlookEntry(invite);
  const { token, hash } = newInviteToken();
  const expiresAt = DateTime.utc().plus({ days: INVITE_DAYS }).endOf("day").toISO()!;
  await releaseBooking(bookingId, { status: "invited", tokenHash: hash, expiresAt });
  const link = linkFor(recruiter, token);
  const canEmail = sendEmail && mailConfigured();
  const email = canEmail
    ? await sendToCandidate(
        recruiter,
        candidateOf(invite),
        inviteContent(recruiter, candidateOf(invite), {
          jobTitle: invite.interview.jobTitle,
          durationMins: invite.interview.durationMins,
          link,
          expiresAt,
          reschedule: true,
        }),
      )
    : null;
  after(() =>
    logToJobAdder(
      invite.jobadderCandidateId,
      note(
        `Interview${was ? ` on ${was}` : ""} moved via COSInterview: the candidate has a new link to choose another time (works until ${inviteExpiry(expiresAt)}).`,
        email,
      ),
    ),
  );
  // No revalidatePath: the row would move sections and the new link would vanish
  // before it's copied. The list refreshes when the recruiter closes it.
  return { ok: true, link, emailed: Boolean(email), error: canEmail && !email ? EMAIL_FAILED : undefined };
}

export async function cancelBooking(bookingId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { invite } = await ownBooking(bookingId);
  if (invite.status !== "invited" && invite.status !== "booked") {
    return { ok: false, error: "This interview can't be cancelled now." };
  }
  // Read before releasing: releasing clears the booked time.
  const candidateWhen = bookedWhen(invite, invite.candidateTimezone ?? invite.recruiter.timezone);
  const was = bookedWhen(invite, invite.recruiter.timezone);
  await removeOutlookEntry(invite);
  await releaseBooking(bookingId, { status: "cancelled" });

  // A booked candidate is told; someone who hadn't booked just finds the link no longer works.
  const email =
    candidateWhen && mailConfigured()
      ? await sendToCandidate(
          invite.recruiter,
          candidateOf(invite),
          cancellationEmail({
            candidateName: invite.candidateName,
            recruiterName: invite.recruiter.displayName,
            recruiterTitle: invite.recruiter.title,
            jobTitle: invite.interview.jobTitle,
            when: candidateWhen,
          }),
        )
      : null;
  after(() =>
    logToJobAdder(invite.jobadderCandidateId, note(`Interview${was ? ` on ${was}` : " invite"} cancelled via COSInterview.`, email)),
  );
  revalidatePath("/r");
  return { ok: true };
}
