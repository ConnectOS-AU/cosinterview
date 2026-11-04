import "server-only";
import { DateTime } from "luxon";
import { getTemplates } from "./template-store";
import { renderEmail, renderMessage, type MessageTemplateId, type Vars } from "./templates";

// Emails a candidate or attendee receives in their recruiter's name (sent by
// lib/mail.ts), from the templates admins edit (lib/templates.ts), and the body
// of the recruiter's Outlook entry. Each email has inline-styled HTML, so it
// renders the same in Outlook and Gmail, plus a plain-text version that also
// goes into the candidate's JobAdder note.

export type EmailContent = { subject: string; bodyHtml: string; text: string };

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const WRAP = 'style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2933;max-width:560px"';
const BUTTON =
  'style="background:#12798f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block"';

type Sender = { recruiterName: string; recruiterTitle: string | null };

const first = (name: string) => name.split(" ")[0] ?? name;

// "Thursday 29 October, 1:00 pm – 1:30 pm (Sydney time)"
export function formatSlot(start: string, end: string, zone: string): string {
  const s = DateTime.fromISO(start, { zone });
  const e = DateTime.fromISO(end, { zone });
  const place = zone.replace(/_/g, " ").split("/").pop();
  return `${s.toFormat("cccc d LLLL")}, ${s.toFormat("h:mm a").toLowerCase()} – ${e.toFormat("h:mm a").toLowerCase()} (${place} time)`;
}

// The placeholders every candidate email and message can use.
export function candidateVars(input: Sender & { candidateName: string; jobTitle: string | null }): Vars {
  return {
    firstName: first(input.candidateName),
    candidateName: input.candidateName,
    jobTitle: input.jobTitle ?? "",
    forRole: input.jobTitle ? ` for the ${input.jobTitle} role` : "",
    dashJob: input.jobTitle ? ` – ${input.jobTitle}` : "",
    recruiterName: input.recruiterName,
    recruiterTitle: input.recruiterTitle ? `${input.recruiterTitle}, ConnectOS` : "ConnectOS",
  };
}

export const onWhen = (when: string | null) => (when ? ` on ${when}` : "");

// A WhatsApp/Viber message from its template.
export async function messageText(id: MessageTemplateId, vars: Vars): Promise<string> {
  return renderMessage((await getTemplates()).messages[id], vars);
}

export async function inviteEmail(
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
): Promise<EmailContent> {
  return renderEmail(await getTemplates(), input.reschedule ? "reschedule" : "invite", {
    ...candidateVars(input),
    durationMins: String(input.durationMins),
    expires: DateTime.fromISO(input.expiresAt).setZone("Asia/Manila").toFormat("cccc d LLLL"),
    link: input.link,
    message: input.message?.trim() || null,
  });
}

// Sent when the candidate books. The .ics file goes with it as an attachment.
export async function bookingConfirmationEmail(
  input: Sender & {
    candidateName: string;
    jobTitle: string | null;
    when: string;
    bookingPage: string;
    roomLink: string;
    googleUrl: string;
    outlookUrl: string;
  },
): Promise<EmailContent> {
  return renderEmail(await getTemplates(), "confirmation", {
    ...candidateVars(input),
    when: input.when,
    roomLink: input.roomLink,
    bookingPage: input.bookingPage,
    googleCalendarUrl: input.googleUrl,
    outlookCalendarUrl: input.outlookUrl,
  });
}

// Sent when the recruiter cancels a booked interview.
export async function cancellationEmail(input: Sender & { candidateName: string; jobTitle: string | null; when: string }): Promise<EmailContent> {
  return renderEmail(await getTemplates(), "cancellation", { ...candidateVars(input), when: input.when });
}

// Sent instead when the booking was closed because a new invite is on its way.
export async function interviewChangedEmail(input: Sender & { candidateName: string; jobTitle: string | null; when: string }): Promise<EmailContent> {
  return renderEmail(await getTemplates(), "interviewChanged", { ...candidateVars(input), when: input.when });
}

// Body of the recruiter's own Outlook entry.
export function recruiterEventBody(input: {
  candidateName: string;
  candidateEmail: string;
  jobTitle: string | null;
  clientName: string | null;
  candidateWhen: string | null;
  whatsapp: string | null;
  viber: string | null;
  link: string;
}): string {
  return `
<div ${WRAP}>
  <p><a href="${escape(input.link)}" ${BUTTON}>Open the interview</a></p>
  <p>The interview screen has the video call, lobby admit and your notes.</p>
  <p><strong>Candidate:</strong> ${escape(input.candidateName)} (${escape(input.candidateEmail)})<br>
  ${input.jobTitle ? `<strong>Role:</strong> ${escape(input.jobTitle)}${input.clientName ? ` · ${escape(input.clientName)}` : ""}<br>` : ""}
  ${input.candidateWhen ? `<strong>Candidate's time:</strong> ${escape(input.candidateWhen)}<br>` : ""}
  ${input.whatsapp ? `<strong>WhatsApp:</strong> ${escape(input.whatsapp)}<br>` : ""}
  ${input.viber ? `<strong>Viber:</strong> ${escape(input.viber)}` : ""}</p>
</div>`.trim();
}

// Tells the recruiter a candidate has booked, or moved their booking. Plain
// wording rather than an admin template: it's for staff only.
export function recruiterBookingEmail(input: {
  candidateName: string;
  candidateEmail: string;
  jobTitle: string | null;
  clientName: string | null;
  stage: string;
  when: string;
  candidateWhen: string | null;
  whatsapp: string | null;
  viber: string | null;
  // The time it was moved from, and how many attendees were invited for that time.
  moved: { was: string; attendees: number } | null;
  link: string;
}): EmailContent {
  const { moved } = input;
  const role = input.jobTitle ? `${input.jobTitle}${input.clientName ? ` · ${input.clientName}` : ""}` : null;
  const attendees = moved?.attendees
    ? `${moved.attendees} attendee${moved.attendees === 1 ? " was" : "s were"} invited for the old time and ${moved.attendees === 1 ? "hasn't" : "haven't"} been told about the move.`
    : null;
  const lines: [string, string][] = [
    ["Candidate", `${input.candidateName} (${input.candidateEmail})`],
    ...(role ? [["Role", role] as [string, string]] : []),
    ["Interview", input.stage],
    ["When", input.when],
    ...(moved ? [["Was", moved.was] as [string, string]] : []),
    ...(input.candidateWhen ? [["Candidate's time", input.candidateWhen] as [string, string]] : []),
    ...(input.whatsapp ? [["WhatsApp", input.whatsapp] as [string, string]] : []),
    ...(input.viber ? [["Viber", input.viber] as [string, string]] : []),
  ];
  const intro = moved ? `${input.candidateName} has moved their interview to a new time.` : `${input.candidateName} has booked an interview.`;
  return {
    subject: `Interview ${moved ? "moved" : "booked"}: ${input.candidateName}${input.jobTitle ? ` – ${input.jobTitle}` : ""}`,
    bodyHtml: `
<div ${WRAP}>
  <p>${escape(intro)}</p>
  <p>${lines.map(([label, value]) => `<strong>${escape(label)}:</strong> ${escape(value)}`).join("<br>")}</p>
  ${attendees ? `<p>${escape(attendees)}</p>` : ""}
  <p><a href="${escape(input.link)}" ${BUTTON}>Open the interview</a></p>
</div>`.trim(),
    text: [intro, lines.map(([label, value]) => `${label}: ${value}`).join("\n"), attendees, `Open the interview: ${input.link}`].filter(Boolean).join("\n\n"),
  };
}

// To the recruiter once the overview after an interview is written. `overview` is
// what goes into JobAdder: blank-line separated sections.
export function recruiterOverviewEmail(input: { candidateName: string; jobTitle: string | null; overview: string; link: string }): EmailContent {
  const sections = input.overview.split("\n\n");
  return {
    subject: `Candidate overview: ${input.candidateName}${input.jobTitle ? ` – ${input.jobTitle}` : ""}`,
    bodyHtml: `
<div ${WRAP}>
  ${sections.map((s) => `<p>${escape(s).replace(/\n/g, "<br>")}</p>`).join("\n  ")}
  <p><a href="${escape(input.link)}" ${BUTTON}>Open the candidate overview</a></p>
</div>`.trim(),
    text: [input.overview, `Open the candidate overview: ${input.link}`].join("\n\n"),
  };
}

// Sent 24 hours and 2 hours before the interview. roomLink is null when the
// candidate's link couldn't be recovered; they're pointed to their confirmation.
export async function reminderEmail(
  input: Sender & {
    kind: "24h" | "2h";
    candidateName: string;
    jobTitle: string | null;
    when: string;
    roomLink: string | null;
  },
): Promise<EmailContent> {
  return renderEmail(await getTemplates(), input.kind === "2h" ? "reminder2h" : "reminder24h", {
    ...candidateVars(input),
    when: input.when,
    roomLink: input.roomLink,
  });
}

// An attendee's invitation (client or Other), with their personal link to the
// attendee lobby. The candidate's formatted resume goes with it as an
// attachment when there is one, and the job description is added after the
// signature.
export async function guestInviteEmail(
  input: Sender & {
    guestName: string | null;
    candidateName: string;
    jobTitle: string | null;
    stage: string;
    when: string | null;
    link: string;
    resumeAttached: boolean;
    // Cleaned HTML from JobAdder, and the same as plain text.
    jobDescription: { html: string; text: string } | null;
  },
): Promise<EmailContent> {
  const name = first(input.candidateName);
  const resume = input.resumeAttached ? `${name}'s resume is attached` : `${name}'s resume will be in your waiting room once it's ready`;
  const jd = input.jobDescription;
  const heading = `Job description${input.jobTitle ? ` - ${input.jobTitle}` : ""}`;
  return renderEmail(
    await getTemplates(),
    "guestInvite",
    {
      ...candidateVars(input),
      attendeeFirstName: input.guestName ? first(input.guestName) : "there",
      stage: input.stage,
      onWhen: onWhen(input.when),
      documents: jd ? `${resume}, and the job description is below.` : `${resume}.`,
      link: input.link,
    },
    jd
      ? {
          html:
            `<hr style="border:none;border-top:1px solid #e4e7eb;margin:28px 0 20px">` +
            `<p style="font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:#52606d">${escape(heading)}</p>` +
            `<div style="font-size:14px">${jd.html}</div>`,
          text: `---\n\n${heading.toUpperCase()}\n\n${jd.text}`,
        }
      : undefined,
  );
}
