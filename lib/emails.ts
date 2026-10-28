import "server-only";
import { DateTime } from "luxon";

// Emails a candidate receives from their recruiter's mailbox, and the body of
// the recruiter's Outlook entry. Plain, inline-styled HTML so it renders the
// same in Outlook and Gmail.

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const WRAP = 'style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2933;max-width:560px"';
const MUTED = 'style="font-size:13px;color:#52606d"';
const BUTTON =
  'style="background:#12798f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block"';

type Sender = { recruiterName: string; recruiterTitle: string | null };

function signature({ recruiterName, recruiterTitle }: Sender): string {
  return `<p>Kind regards,<br>${escape(recruiterName)}${recruiterTitle ? `<br><span style="color:#52606d">${escape(recruiterTitle)}, ConnectOS</span>` : "<br>ConnectOS"}</p>`;
}

const firstName = (name: string) => escape(name.split(" ")[0]);

// "Thursday 29 October, 1:00 pm – 1:30 pm (Sydney time)"
export function formatSlot(start: string, end: string, zone: string): string {
  const s = DateTime.fromISO(start, { zone });
  const e = DateTime.fromISO(end, { zone });
  const place = zone.replace(/_/g, " ").split("/").pop();
  return `${s.toFormat("cccc d LLLL")}, ${s.toFormat("h:mm a").toLowerCase()} – ${e.toFormat("h:mm a").toLowerCase()} (${place} time)`;
}

export function inviteEmail(
  input: Sender & {
    candidateName: string;
    jobTitle: string | null;
    durationMins: number;
    link: string;
    expiresAt: string;
    reschedule?: boolean;
    // The recruiter's own words, shown above the standard text.
    message?: string | null;
  },
): { subject: string; bodyHtml: string } {
  const role = input.jobTitle ? ` for the ${escape(input.jobTitle)} role` : "";
  const expires = DateTime.fromISO(input.expiresAt).setZone("Asia/Manila").toFormat("cccc d LLLL");
  const subject = input.reschedule
    ? "Please choose a new time for your ConnectOS interview"
    : `Your ConnectOS interview${input.jobTitle ? ` – ${input.jobTitle}` : ""}`;
  const intro = input.reschedule
    ? `Our interview${role} needs a new time. Please choose another time that suits you.`
    : `Thanks for your application${role}. I'd love to meet you in a ${input.durationMins}-minute video interview.`;
  const message = input.message?.trim()
    ? `<p style="white-space:pre-wrap;border-left:3px solid #12798f;padding-left:12px">${escape(input.message.trim())}</p>`
    : "";

  const bodyHtml = `
<div ${WRAP}>
  <p>Hi ${firstName(input.candidateName)},</p>
  ${message}
  <p>${intro}</p>
  <p>Use the button below to pick a time from my calendar. The interview runs in your web browser, so there's nothing to install - just use a computer or phone with a camera and microphone.</p>
  <p style="margin:28px 0"><a href="${escape(input.link)}" ${BUTTON}>Choose your interview time</a></p>
  <p ${MUTED}>This link is personal to you and works until ${escape(expires)}. If the button doesn't work, copy this address into your browser:<br><span style="word-break:break-all">${escape(input.link)}</span></p>
  ${signature(input)}
</div>`.trim();
  return { subject, bodyHtml };
}

// Sent when the candidate books. The .ics file goes with it as an attachment.
export function bookingConfirmationEmail(
  input: Sender & {
    candidateName: string;
    jobTitle: string | null;
    when: string;
    bookingPage: string;
    roomLink: string;
    googleUrl: string;
    outlookUrl: string;
  },
): { subject: string; bodyHtml: string } {
  const role = input.jobTitle ? ` for the ${escape(input.jobTitle)} role` : "";
  const subject = `Confirmed: your ConnectOS interview${input.jobTitle ? ` – ${input.jobTitle}` : ""}`;
  const bodyHtml = `
<div ${WRAP}>
  <p>Hi ${firstName(input.candidateName)},</p>
  <p>Thanks for booking - your video interview${role} is confirmed.</p>
  <p style="font-size:17px;font-weight:bold;margin:20px 0">${escape(input.when)}</p>
  <p><strong>Add it to your calendar:</strong> open the attached <em>connectos-interview.ics</em> file, or use
    <a href="${escape(input.googleUrl)}">Google Calendar</a> ·
    <a href="${escape(input.outlookUrl)}">Outlook.com</a>.</p>
  <p style="margin:28px 0"><a href="${escape(input.roomLink)}" ${BUTTON}>Join the interview</a></p>
  <p ${MUTED}>The room opens 15 minutes before the start time. Use a computer or phone with a camera and microphone - there's nothing to install. Need to check your booking? <a href="${escape(input.bookingPage)}">View it here</a>.</p>
  ${signature(input)}
</div>`.trim();
  return { subject, bodyHtml };
}

// Sent when the recruiter cancels a booked interview.
export function cancellationEmail(
  input: Sender & { candidateName: string; jobTitle: string | null; when: string },
): { subject: string; bodyHtml: string } {
  const role = input.jobTitle ? ` for the ${escape(input.jobTitle)} role` : "";
  const subject = `Cancelled: your ConnectOS interview${input.jobTitle ? ` – ${input.jobTitle}` : ""}`;
  const bodyHtml = `
<div ${WRAP}>
  <p>Hi ${firstName(input.candidateName)},</p>
  <p>I'm sorry - our video interview${role} on <strong>${escape(input.when)}</strong> has been cancelled. Please remove it from your calendar. I'll be in touch if anything changes.</p>
  ${signature(input)}
</div>`.trim();
  return { subject, bodyHtml };
}

// Body of the recruiter's own Outlook entry.
export function recruiterEventBody(input: {
  candidateName: string;
  candidateEmail: string;
  jobTitle: string | null;
  clientName: string | null;
  candidateWhen: string | null;
  link: string;
}): string {
  return `
<div ${WRAP}>
  <p><a href="${escape(input.link)}" ${BUTTON}>Open the interview</a></p>
  <p>The interview screen has the video call, lobby admit and your notes.</p>
  <p><strong>Candidate:</strong> ${escape(input.candidateName)} (${escape(input.candidateEmail)})<br>
  ${input.jobTitle ? `<strong>Role:</strong> ${escape(input.jobTitle)}${input.clientName ? ` · ${escape(input.clientName)}` : ""}<br>` : ""}
  ${input.candidateWhen ? `<strong>Candidate's time:</strong> ${escape(input.candidateWhen)}` : ""}</p>
</div>`.trim();
}
