"use server";

import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { cancellationEmail, interviewChangedEmail, candidateVars, type EmailContent, formatSlot, inviteEmail, messageText, onWhen } from "@/lib/emails";
import { processDueReviews } from "@/lib/candidate-review";
import { deleteInterviewEvent, graphConfigured } from "@/lib/graph";
import { siteUrl } from "@/lib/invite";
import { mailConfigured, mailForNote, sendCandidateMail } from "@/lib/mail";
import { messageCandidate } from "@/lib/messaging";
import { findInviteById, releaseBooking } from "@/lib/repo";
import { requireRecruiter } from "@/lib/staff/auth";
import { INTERVIEW_LENGTHS } from "@/lib/staff/options";
import { getJob, listApplications } from "@/lib/staff/jobadder";
import { logToJobAdder } from "@/lib/staff/jobadder-api";
import { createInvites, openInterviewFor, replaceInviteToken, stagesForJob, type CandidateStage } from "@/lib/staff/repo";
import { isStage, stageLabel, type Stage } from "@/lib/stages";
import { newInviteToken } from "@/lib/tokens";
import type { BookingStatus, InviteRecord, NewInvite, RecruiterProfile } from "@/lib/types";

const INVITE_DAYS = 14;
const MAX_PER_BATCH = 50;
const MAX_MESSAGE = 1000;
const FIRST_OVERVIEWS = 5;

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
async function sendToCandidate(recruiter: Recruiter, to: { name: string; email: string }, pending: Promise<EmailContent>): Promise<string | null> {
  const content = await pending;
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
const note = (summary: string, ...sent: (string | null)[]) => [summary, ...sent].filter(Boolean).join("\n\n");

const numbersOf = (invite: InviteRecord) => ({ whatsapp: invite.candidateWhatsapp, viber: invite.candidateViber });
const varsOf = (invite: InviteRecord) =>
  candidateVars({ candidateName: invite.candidateName, jobTitle: invite.interview.jobTitle, recruiterName: invite.recruiter.displayName, recruiterTitle: invite.recruiter.title });

const EMAIL_FAILED = "Email couldn't be sent - copy the link instead.";

function inviteContent(
  recruiter: RecruiterProfile,
  to: { name: string },
  details: { jobTitle: string | null; durationMins: number; link: string; expiresAt: string; reschedule?: boolean; message?: string | null },
): Promise<EmailContent> {
  return inviteEmail({ candidateName: to.name, recruiterName: recruiter.displayName, recruiterTitle: recruiter.title, ...details });
}

// Creates (or reuses) the open interview for this job and invites the chosen
// candidates, closing any interview they still have open on the job, so only the
// newest link works. Emails go out through SendGrid in the recruiter's name when it's
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
  // already been invited to (or done) this stage. Missing it gets a second chance.
  const [applications, stages] = await Promise.all([listApplications(job.jobId), stagesForJob(job.jobId)]);
  const hereWith = (id: string, match: (status: BookingStatus) => boolean) => (stages.get(id) ?? []).some((s) => s.stage === input.stage && match(s.status));
  const atStage = (id: string) => hereWith(id, (status) => status !== "no_show");
  const missedIt = (id: string) => hereWith(id, (status) => status === "no_show");
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

  // A second chance is a new booking, in its own round, so the no-show stays on
  // record for their punctuality.
  const second = invites.filter((i) => missedIt(i.candidateId));
  const first = invites.filter((i) => !missedIt(i.candidateId));
  const created = new Map<string, string>();
  if (first.length) {
    const interview = await openInterviewFor(recruiter, job, input.durationMins, staff.userId, input.stage);
    for (const [id, bookingId] of await createInvites(recruiter, interview, first)) created.set(id, bookingId);
  }
  if (second.length) {
    const interview = await openInterviewFor(recruiter, job, input.durationMins, staff.userId, input.stage, { newRound: true });
    for (const [id, bookingId] of await createInvites(recruiter, interview, second)) created.set(id, bookingId);
  }
  const canEmail = input.sendEmail && mailConfigured();
  const message = input.message?.trim().slice(0, MAX_MESSAGE) || null;

  const sent: SentInvite[] = [];
  const notes: { candidateId: string; text: string }[] = [];
  for (const invite of invites) {
    if (!created.has(invite.candidateId)) {
      skipped.push(invite.name);
      continue;
    }
    const closed = await closeOpenInterviews(stages.get(invite.candidateId) ?? []);
    const link = linkFor(recruiter, tokens.get(invite.candidateId)!);
    const email = canEmail
      ? await sendToCandidate(recruiter, invite, inviteContent(recruiter, invite, { jobTitle: job.title, durationMins: input.durationMins, link, expiresAt, message }))
      : null;
    const failed = canEmail && !email;
    const problem = [failed && EMAIL_FAILED, !closed && "Their earlier interview couldn't be closed - cancel it from the interview list."].filter(Boolean).join(" ");
    sent.push({ name: invite.name, email: invite.email, link, emailed: Boolean(email), error: problem || undefined });
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
    // Their candidate overviews: the first few now, the worker does any others.
    await processDueReviews(FIRST_OVERVIEWS).catch((err) => console.error("[invite] Writing overviews failed", err));
  });

  revalidatePath("/r");
  return { ok: true, sent, skipped };
}

export type ProgressResult = { ok: true; sent: SentInvite[]; skipped: string[]; failed: string[] } | { ok: false; error: string };

// Invites candidates across jobs, each to their own stage. An invitation is for
// one job and stage, so it's sent in those groups; one failing doesn't stop the rest.
export async function progressCandidates(input: {
  picks: { jobId: string; candidateId: string; stage: Stage }[];
  durationMins: number;
  sendEmail: boolean;
  message?: string;
}): Promise<ProgressResult> {
  await requireRecruiter();
  if (input.picks.length === 0) return { ok: false, error: "Select at least one candidate." };
  if (input.picks.length > MAX_PER_BATCH) return { ok: false, error: `Choose up to ${MAX_PER_BATCH} at a time.` };

  const groups = new Map<string, { jobId: string; stage: Stage; candidateIds: string[] }>();
  for (const { jobId, candidateId, stage } of input.picks) {
    const key = `${jobId}:${stage}`;
    const group = groups.get(key) ?? { jobId, stage, candidateIds: [] };
    group.candidateIds.push(candidateId);
    groups.set(key, group);
  }

  const sent: SentInvite[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const group of groups.values()) {
    const outcome = isStage(group.stage) ? stageLabel(group.stage) : "that stage";
    const none = `${group.candidateIds.length} candidate${group.candidateIds.length === 1 ? "" : "s"} for ${outcome}`;
    try {
      const res = await createInvitations({ ...group, durationMins: input.durationMins, sendEmail: input.sendEmail, message: input.message });
      if (res.ok) {
        sent.push(...res.sent);
        skipped.push(...res.skipped);
      } else {
        failed.push(`${none}: ${res.error}`);
      }
    } catch (err) {
      console.error("[progress] Inviting failed", group.jobId, group.stage, err);
      failed.push(none);
    }
  }
  return { ok: true, sent, skipped, failed };
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
  const candidateWas = bookedWhen(invite, invite.candidateTimezone ?? recruiter.timezone);
  const message = sendEmail
    ? await messageCandidate(
        numbersOf(invite),
        await messageText("msgReschedule", { ...varsOf(invite), onWhen: onWhen(candidateWas), link }),
      )
    : null;
  after(() =>
    logToJobAdder(
      invite.jobadderCandidateId,
      note(
        `Interview${was ? ` on ${was}` : ""} moved via COSInterview: the candidate has a new link to choose another time (works until ${inviteExpiry(expiresAt)}).`,
        email,
        message,
      ),
    ),
  );
  // No revalidatePath: the row would move sections and the new link would vanish
  // before it's copied. The list refreshes when the recruiter closes it.
  return { ok: true, link, emailed: Boolean(email), error: canEmail && !email ? EMAIL_FAILED : undefined };
}

const isOpen = (status: BookingStatus) => status === "invited" || status === "booked";

export async function cancelBooking(bookingId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { invite } = await ownBooking(bookingId);
  if (!isOpen(invite.status)) return { ok: false, error: "This interview can't be cancelled now." };
  await closeInterview(invite, "cancelled");
  revalidatePath("/r");
  return { ok: true };
}

// Closes a candidate's interviews that haven't happened yet. One that fails is
// logged and reported, and doesn't stop the new invite. False if any failed.
async function closeOpenInterviews(interviews: CandidateStage[]): Promise<boolean> {
  let closedAll = true;
  for (const { bookingId, status } of interviews) {
    if (!isOpen(status)) continue;
    try {
      const invite = await findInviteById(bookingId);
      if (invite && isOpen(invite.status)) await closeInterview(invite, "replaced");
    } catch (err) {
      console.error("[invite] Closing an earlier interview failed", bookingId, err);
      closedAll = false;
    }
  }
  return closedAll;
}

async function closeInterview(invite: InviteRecord, why: "cancelled" | "replaced"): Promise<void> {
  // Read before releasing: releasing clears the booked time.
  const candidateWhen = bookedWhen(invite, invite.candidateTimezone ?? invite.recruiter.timezone);
  const was = bookedWhen(invite, invite.recruiter.timezone);
  await removeOutlookEntry(invite);
  await releaseBooking(invite.bookingId, { status: "cancelled" });

  // A booked candidate is told; someone who hadn't booked just finds the link no
  // longer works. "Replaced" means a new invite follows, so it isn't a cancellation.
  const replaced = why === "replaced";
  const email =
    candidateWhen && mailConfigured()
      ? await sendToCandidate(
          invite.recruiter,
          candidateOf(invite),
          (replaced ? interviewChangedEmail : cancellationEmail)({
            candidateName: invite.candidateName,
            recruiterName: invite.recruiter.displayName,
            recruiterTitle: invite.recruiter.title,
            jobTitle: invite.interview.jobTitle,
            when: candidateWhen,
          }),
        )
        : null;
  const message = candidateWhen
    ? await messageCandidate(
        numbersOf(invite),
        await messageText(replaced ? "msgInterviewChanged" : "msgCancellation", { ...varsOf(invite), onWhen: onWhen(candidateWhen) }),
      )
    : null;
  after(() =>
    logToJobAdder(invite.jobadderCandidateId, note(`Interview${was ? ` on ${was}` : " invite"} ${replaced ? "closed because a new invite was sent" : "cancelled"} via COSInterview.`, email, message)),
  );
}
