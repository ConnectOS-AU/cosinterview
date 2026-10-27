import "server-only";
import { DateTime } from "luxon";

// The invitation email a candidate receives from their recruiter's mailbox.
// Plain, inline-styled HTML so it renders the same in Outlook and Gmail.

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function inviteEmail(input: {
  candidateName: string;
  recruiterName: string;
  recruiterTitle: string | null;
  jobTitle: string | null;
  durationMins: number;
  link: string;
  expiresAt: string;
  reschedule?: boolean;
}): { subject: string; bodyHtml: string } {
  const first = input.candidateName.split(" ")[0];
  const role = input.jobTitle ? ` for the ${escape(input.jobTitle)} role` : "";
  const expires = DateTime.fromISO(input.expiresAt).setZone("Asia/Manila").toFormat("cccc d LLLL");
  const subject = input.reschedule
    ? "Please choose a new time for your ConnectOS interview"
    : `Your ConnectOS interview${input.jobTitle ? ` – ${input.jobTitle}` : ""}`;
  const intro = input.reschedule
    ? `Our interview${role} needs a new time. Please choose another time that suits you.`
    : `Thanks for your application${role}. I'd love to meet you in a ${input.durationMins}-minute video interview.`;

  const bodyHtml = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2933;max-width:560px">
  <p>Hi ${escape(first)},</p>
  <p>${intro}</p>
  <p>Use the button below to pick a time from my calendar. The interview runs in your web browser, so there's nothing to install - just use a computer or phone with a camera and microphone.</p>
  <p style="margin:28px 0">
    <a href="${escape(input.link)}" style="background:#12798f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">Choose your interview time</a>
  </p>
  <p style="font-size:13px;color:#52606d">This link is personal to you and works until ${escape(expires)}. If the button doesn't work, copy this address into your browser:<br><span style="word-break:break-all">${escape(input.link)}</span></p>
  <p>Kind regards,<br>${escape(input.recruiterName)}${input.recruiterTitle ? `<br><span style="color:#52606d">${escape(input.recruiterTitle)}, ConnectOS</span>` : "<br>ConnectOS"}</p>
</div>`.trim();
  return { subject, bodyHtml };
}
