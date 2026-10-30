import "server-only";
import { demoMode } from "./demo";

// Candidate emails go out through SendGrid, like COSHub's: from the verified
// SENDGRID_FROM_EMAIL address but in the recruiter's name, with replies going
// to the recruiter. Click tracking is off so personal links aren't rewritten
// through a tracking redirect. In the local demo (or EMAIL_DRY_RUN=true) the
// email is logged instead of sent.

// Text content (a calendar file) or a file's bytes (a resume).
export type MailAttachment = { filename: string; contentType: string; content: string | Buffer };

export type CandidateMail = {
  to: { name: string; email: string };
  recruiter: { name: string; email: string };
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
};

const dryRun = () => demoMode() || process.env.EMAIL_DRY_RUN === "true";

export function mailConfigured(): boolean {
  return dryRun() || Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);
}

export async function sendCandidateMail(mail: CandidateMail): Promise<void> {
  if (dryRun()) {
    const files = mail.attachments?.length ? `Attachments: ${mail.attachments.map((a) => a.filename).join(", ")}\n` : "";
    console.info(`[email dry-run] To: ${mail.to.email}\nReply-To: ${mail.recruiter.email}\n${files}Subject: ${mail.subject}\n\n${mail.text}\n`);
    return;
  }
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Email isn't configured (SENDGRID_API_KEY / SENDGRID_FROM_EMAIL).");

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [mail.to] }],
      from: { email: from, name: `${mail.recruiter.name} at ${process.env.SENDGRID_FROM_NAME || "ConnectOS"}` },
      reply_to: mail.recruiter,
      subject: mail.subject,
      content: [
        { type: "text/plain", value: mail.text },
        { type: "text/html", value: mail.html },
      ],
      ...(mail.attachments?.length && {
        attachments: mail.attachments.map((a) => ({
          content: (Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content, "utf8")).toString("base64"),
          filename: a.filename,
          type: a.contentType,
          disposition: "attachment",
        })),
      }),
      tracking_settings: {
        click_tracking: { enable: false, enable_text: false },
        open_tracking: { enable: false },
      },
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`SendGrid rejected the email (${res.status}): ${(await res.text()).slice(0, 300)}`);
}

// The candidate's personal link (/c/<recruiter>/<token>, and its /room page)
// works like a password for their booking, and only its hash is stored here -
// so JobAdder gets a placeholder instead.
const PERSONAL_LINK = /https?:\/\/[^\s"<>]+\/c\/[^/\s"<>]+\/[A-Za-z0-9_-]{20,}(?:\/room)?/g;

// What goes into the JobAdder note: who it went to and what it said.
export function mailForNote(mail: Pick<CandidateMail, "to" | "subject" | "text">): string {
  const text = mail.text.replace(PERSONAL_LINK, "[candidate's personal link]");
  return `--- Email sent to ${mail.to.name} <${mail.to.email}> ---\nSubject: ${mail.subject}\n\n${text}`;
}
