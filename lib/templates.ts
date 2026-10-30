// Email and WhatsApp/Viber message templates: the defaults, what each one can
// use, and how a template becomes an email or a message. Admins edit them at
// /r/admin/templates (stored by lib/template-store.ts). No server-only import:
// the editor's preview renders with exactly this code.
//
// A template is plain text with {{placeholders}}. Blank lines separate
// paragraphs. **bold**, [label](link) and a "## " line (shown large, for the
// interview time) are the only formatting. A line using a placeholder that has
// no value for that email (e.g. a room link that can't be recovered) is left
// out. {{message}} on its own line is where the recruiter's personal message
// goes in an invitation.

export type EmailTemplateId = "invite" | "reschedule" | "confirmation" | "reminder24h" | "reminder2h" | "cancellation" | "guestInvite";
export type MessageTemplateId = "msgConfirmation" | "msgReminder24h" | "msgReminder2h" | "msgReschedule" | "msgCancellation";

export type EmailTemplate = { subject: string; body: string; button: string; footer: string };
export type Templates = {
  emails: Record<EmailTemplateId, EmailTemplate>;
  messages: Record<MessageTemplateId, string>;
  signature: string;
};
// What's stored: only what an admin changed.
export type TemplateOverrides = {
  emails?: Partial<Record<EmailTemplateId, Partial<EmailTemplate>>>;
  messages?: Partial<Record<MessageTemplateId, string>>;
  signature?: string;
};

// A placeholder's value; null means "not available for this one" and drops the line.
export type Vars = Record<string, string | null>;

export const TEMPLATE_LIMITS = { subject: 200, body: 5000, button: 60, footer: 2000, message: 1000, signature: 500 };

export const PLACEHOLDERS: Record<string, { label: string; sample: string }> = {
  firstName: { label: "Candidate's first name", sample: "Maria" },
  candidateName: { label: "Candidate's full name", sample: "Maria Santos" },
  jobTitle: { label: "Job title", sample: "Customer Support Specialist" },
  forRole: { label: '" for the <job> role" - blank when there\'s no job title', sample: " for the Customer Support Specialist role" },
  dashJob: { label: '" – <job>" - blank when there\'s no job title', sample: " – Customer Support Specialist" },
  durationMins: { label: "Interview length in minutes", sample: "30" },
  when: { label: "Interview date and time (in the reader's time zone)", sample: "Friday 30 October, 12:00 pm – 12:30 pm (Manila time)" },
  onWhen: { label: '" on <date and time>" - blank when not booked', sample: " on Friday 30 October, 12:00 pm – 12:30 pm (Manila time)" },
  expires: { label: "The day the booking link stops working", sample: "Friday 13 November" },
  link: { label: "The reader's personal link (booking page, or the attendee's room)", sample: "https://interviews.connectos.co/c/rei/abc123" },
  message: { label: "The recruiter's personal message, if they wrote one", sample: "Great chatting on the phone today - looking forward to it!" },
  roomLink: { label: "Link to join the video call", sample: "https://interviews.connectos.co/c/rei/abc123/room" },
  bookingPage: { label: "Link to see or change the booking", sample: "https://interviews.connectos.co/c/rei/abc123" },
  googleCalendarUrl: { label: "Add to Google Calendar link", sample: "https://calendar.google.com/calendar/render?action=TEMPLATE" },
  outlookCalendarUrl: { label: "Add to Outlook.com link", sample: "https://outlook.live.com/calendar/0/deeplink/compose" },
  recruiterName: { label: "Recruiter's name", sample: "Rei Agustin" },
  recruiterTitle: { label: "Recruiter's title, with \", ConnectOS\" (or just ConnectOS)", sample: "Talent Acquisition Specialist, ConnectOS" },
  stage: { label: "Interview stage", sample: "Client interview" },
  attendeeFirstName: { label: "Attendee's first name (\"there\" when unknown)", sample: "Jo" },
  documents: { label: "What came with the invitation (resume attached / job description below)", sample: "Maria's resume is attached, and the job description is below." },
};

const COMMON = ["recruiterName", "recruiterTitle"];
const CANDIDATE = ["firstName", "candidateName", "jobTitle", "forRole", "dashJob", ...COMMON];

type EmailInfo = { label: string; group: "Candidate emails" | "Attendee emails"; sentWhen: string; placeholders: string[]; buttonLink: string | null };
export const EMAILS: Record<EmailTemplateId, EmailInfo> = {
  invite: {
    label: "Interview invitation",
    group: "Candidate emails",
    sentWhen: "When a recruiter invites a candidate to book a time.",
    placeholders: [...CANDIDATE, "durationMins", "expires", "link", "message"],
    buttonLink: "link",
  },
  reschedule: {
    label: "Choose a new time",
    group: "Candidate emails",
    sentWhen: "When a recruiter moves a booked interview or sends a new link.",
    placeholders: [...CANDIDATE, "durationMins", "expires", "link", "message"],
    buttonLink: "link",
  },
  confirmation: {
    label: "Booking confirmation",
    group: "Candidate emails",
    sentWhen: "When the candidate books a time. The calendar file (connectos-interview.ics) is attached.",
    placeholders: [...CANDIDATE, "when", "roomLink", "bookingPage", "googleCalendarUrl", "outlookCalendarUrl"],
    buttonLink: "roomLink",
  },
  reminder24h: {
    label: "Reminder - 24 hours",
    group: "Candidate emails",
    sentWhen: "24 hours before the interview.",
    placeholders: [...CANDIDATE, "when", "roomLink"],
    buttonLink: "roomLink",
  },
  reminder2h: {
    label: "Reminder - 2 hours",
    group: "Candidate emails",
    sentWhen: "2 hours before the interview.",
    placeholders: [...CANDIDATE, "when", "roomLink"],
    buttonLink: "roomLink",
  },
  cancellation: {
    label: "Cancellation",
    group: "Candidate emails",
    sentWhen: "When a recruiter cancels a booked interview.",
    placeholders: [...CANDIDATE, "when"],
    buttonLink: null,
  },
  guestInvite: {
    label: "Attendee invitation",
    group: "Attendee emails",
    sentWhen:
      "When a recruiter adds a client or Other attendee. The candidate's formatted resume is attached, and the job description is added below the signature.",
    placeholders: ["attendeeFirstName", "candidateName", "jobTitle", "forRole", "dashJob", "stage", "onWhen", "documents", "link", ...COMMON],
    buttonLink: "link",
  },
};

export const MESSAGES: Record<MessageTemplateId, { label: string; sentWhen: string; placeholders: string[] }> = {
  msgConfirmation: {
    label: "Booking confirmation",
    sentWhen: "When the candidate books a time.",
    placeholders: [...CANDIDATE, "when", "roomLink", "bookingPage"],
  },
  msgReminder24h: { label: "Reminder - 24 hours", sentWhen: "24 hours before the interview.", placeholders: [...CANDIDATE, "when", "roomLink"] },
  msgReminder2h: { label: "Reminder - 2 hours", sentWhen: "2 hours before the interview.", placeholders: [...CANDIDATE, "when", "roomLink"] },
  msgReschedule: {
    label: "Choose a new time",
    sentWhen: "When a recruiter moves a booked interview.",
    placeholders: [...CANDIDATE, "onWhen", "link"],
  },
  msgCancellation: { label: "Cancellation", sentWhen: "When a recruiter cancels a booked interview.", placeholders: [...CANDIDATE, "onWhen"] },
};

export const SIGNATURE_PLACEHOLDERS = COMMON;

const PICK_TIME =
  "Use the button below to pick a time from my calendar. The interview runs in your web browser, so there's nothing to install - just use a computer or phone with a camera and microphone.";
const LINK_FOOTER =
  "This link is personal to you and works until {{expires}}. If the button doesn't work, copy this address into your browser:\n{{link}}";
const ROOM_FOOTER =
  "The room opens 15 minutes before the start time. Find a quiet spot with good internet, and use a computer or phone with a camera and microphone - there's nothing to install. If you can no longer make it, just reply to this email.";

export const DEFAULT_TEMPLATES: Templates = {
  emails: {
    invite: {
      subject: "Your ConnectOS interview{{dashJob}}",
      body: `Hi {{firstName}},\n\n{{message}}\n\nThanks for your application{{forRole}}. I'd love to meet you in a {{durationMins}}-minute video interview.\n\n${PICK_TIME}`,
      button: "Choose your interview time",
      footer: LINK_FOOTER,
    },
    reschedule: {
      subject: "Please choose a new time for your ConnectOS interview",
      body: `Hi {{firstName}},\n\n{{message}}\n\nOur interview{{forRole}} needs a new time. Please choose another time that suits you.\n\n${PICK_TIME}`,
      button: "Choose your interview time",
      footer: LINK_FOOTER,
    },
    confirmation: {
      subject: "Confirmed: your ConnectOS interview{{dashJob}}",
      body:
        "Hi {{firstName}},\n\nThanks for booking - your video interview{{forRole}} is confirmed.\n\n## {{when}}\n\n" +
        "**Add it to your calendar:** open the attached connectos-interview.ics file, or use [Google Calendar]({{googleCalendarUrl}}) · [Outlook.com]({{outlookCalendarUrl}}).",
      button: "Join the interview",
      footer:
        "The room opens 15 minutes before the start time. Use a computer or phone with a camera and microphone - there's nothing to install. Need to check your booking? [View it here]({{bookingPage}}).",
    },
    reminder24h: {
      subject: "Reminder: your ConnectOS interview{{dashJob}}",
      body: "Hi {{firstName}},\n\nLooking forward to meeting you! A reminder that our video interview{{forRole}} is coming up.\n\n## {{when}}",
      button: "Join the interview",
      footer: ROOM_FOOTER,
    },
    reminder2h: {
      subject: "Starting soon: your ConnectOS interview{{dashJob}}",
      body: "Hi {{firstName}},\n\nJust a reminder that our video interview{{forRole}} starts in about 2 hours.\n\n## {{when}}",
      button: "Join the interview",
      footer: ROOM_FOOTER,
    },
    cancellation: {
      subject: "Cancelled: your ConnectOS interview{{dashJob}}",
      body:
        "Hi {{firstName}},\n\nI'm sorry - our video interview{{forRole}} on **{{when}}** has been cancelled. Please remove it from your calendar. I'll be in touch if anything changes.",
      button: "",
      footer: "",
    },
    guestInvite: {
      subject: "{{stage}}: {{candidateName}}{{dashJob}}",
      body:
        "Hi {{attendeeFirstName}},\n\nYou're invited to the {{stage}} with {{candidateName}}{{forRole}}{{onWhen}}.\n\n{{documents}}\n\n" +
        "Your link below opens your waiting room, with the resume and job description there too and a place to keep notes. When it's time, I'll bring you into the video call - it runs in your web browser, so there's nothing to install.",
      button: "Open your interview room",
      footer: "This link is personal to you - please don't forward it. If the button doesn't work, copy this address into your browser:\n{{link}}",
    },
  },
  messages: {
    msgConfirmation:
      "Hi {{firstName}}, your ConnectOS interview{{forRole}} with {{recruiterName}} is booked for {{when}}.\nJoin the video call here (it opens 15 minutes before): {{roomLink}}\nTo see or change your booking: {{bookingPage}}",
    msgReminder24h:
      "Hi {{firstName}}, a reminder: your ConnectOS interview{{forRole}} with {{recruiterName}} is tomorrow - {{when}}.\nJoin the video call here (it opens 15 minutes before): {{roomLink}}",
    msgReminder2h:
      "Hi {{firstName}}, a reminder: your ConnectOS interview{{forRole}} with {{recruiterName}} is in 2 hours - {{when}}.\nJoin the video call here (it opens 15 minutes before): {{roomLink}}",
    msgReschedule: "Hi {{firstName}}, your ConnectOS interview{{onWhen}} needs to move. Please choose a new time here: {{link}}",
    msgCancellation: "Hi {{firstName}}, your ConnectOS interview{{forRole}}{{onWhen}} has been cancelled. {{recruiterName}} will be in touch.",
  },
  signature: "Kind regards,\n{{recruiterName}}\n{{recruiterTitle}}",
};

// --- Merging and checking -------------------------------------------------------

// Strip control characters (keeping line breaks) and limit the length.
const tidy = (v: unknown, max: number): string | null =>
  typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[^\S\n]+\n/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").slice(0, max) : null;

// The stored overrides, cleaned, laid over the defaults. An empty subject or
// body falls back to the default; an empty button or footer is allowed.
export function mergeTemplates(stored: TemplateOverrides | null | undefined): Templates {
  const emails = {} as Templates["emails"];
  for (const id of Object.keys(EMAILS) as EmailTemplateId[]) {
    const d = DEFAULT_TEMPLATES.emails[id];
    const o = stored?.emails?.[id] ?? {};
    emails[id] = {
      subject: tidy(o.subject, TEMPLATE_LIMITS.subject)?.replace(/\n/g, " ").trim() || d.subject,
      body: tidy(o.body, TEMPLATE_LIMITS.body)?.trim() || d.body,
      button: tidy(o.button, TEMPLATE_LIMITS.button)?.replace(/\n/g, " ").trim() ?? d.button,
      footer: tidy(o.footer, TEMPLATE_LIMITS.footer)?.trim() ?? d.footer,
    };
  }
  const messages = {} as Templates["messages"];
  for (const id of Object.keys(MESSAGES) as MessageTemplateId[]) {
    messages[id] = tidy(stored?.messages?.[id], TEMPLATE_LIMITS.message)?.trim() || DEFAULT_TEMPLATES.messages[id];
  }
  return { emails, messages, signature: tidy(stored?.signature, TEMPLATE_LIMITS.signature)?.trim() || DEFAULT_TEMPLATES.signature };
}

// Placeholders in the text that this template can't fill (typos, or ones from another template).
export function unknownPlaceholders(text: string, allowed: string[]): string[] {
  const found = [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!);
  return [...new Set(found.filter((p) => !allowed.includes(p)))];
}

export function sampleVars(): Vars {
  return Object.fromEntries(Object.entries(PLACEHOLDERS).map(([k, v]) => [k, v.sample]));
}

// --- Rendering ------------------------------------------------------------------

export type RenderedEmail = { subject: string; bodyHtml: string; text: string };

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const WRAP = 'style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2933;max-width:560px"';
const MUTED = "font-size:13px;color:#52606d";
const BUTTON =
  'style="background:#12798f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block"';

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const isUrl = (v: string) => /^https?:\/\/\S+$/.test(v);

// Drops lines that use a placeholder with no value here; unknown placeholders become blank.
function keepLines(template: string, vars: Vars): string {
  return template
    .split("\n")
    .filter((line) => ![...line.matchAll(PLACEHOLDER)].some((m) => vars[m[1]!] === null))
    .join("\n");
}

const fill = (text: string, vars: Vars) => text.replace(PLACEHOLDER, (_, k: string) => vars[k] ?? "");

function paragraphs(template: string, vars: Vars): string[] {
  return keepLines(template, vars)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// One paragraph of text (no links) as HTML: values escaped, URLs linked, **bold**.
function inlineHtml(text: string, vars: Vars): string {
  const parts = text.split(PLACEHOLDER);
  let html = "";
  parts.forEach((part, i) => {
    if (i % 2 === 0) html += escape(part);
    else {
      const value = vars[part] ?? "";
      html += isUrl(value) ? `<a href="${escape(value)}" style="word-break:break-all">${escape(value)}</a>` : escape(value);
    }
  });
  return html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}

function paragraphHtml(p: string, vars: Vars, style = ""): string {
  if (p.startsWith("## ")) return `<p style="font-size:17px;font-weight:bold;margin:20px 0">${inlineHtml(p.slice(3), vars)}</p>`;
  let html = "";
  let last = 0;
  for (const m of p.matchAll(LINK)) {
    html += inlineHtml(p.slice(last, m.index), vars);
    const href = fill(m[2]!, vars);
    const label = inlineHtml(m[1]!, vars);
    html += isUrl(href) ? `<a href="${escape(href)}">${label}</a>` : label;
    last = m.index! + m[0].length;
  }
  html += inlineHtml(p.slice(last), vars);
  return `<p${style ? ` style="${style}"` : ""}>${html}</p>`;
}

function paragraphText(p: string, vars: Vars): string {
  const body = p.startsWith("## ") ? p.slice(3) : p;
  // Very long links (the add-to-calendar ones) would swamp the plain text and the JobAdder note: just their label there.
  const links = body.replace(LINK, (_, label: string, href: string) => (fill(href, vars).length > 150 ? label : `${label}: ${href}`));
  return fill(links, vars).replace(/\*\*(.+?)\*\*/g, "$1");
}

// The plain-text form of a template - WhatsApp/Viber messages, and checks.
export function renderMessage(template: string, vars: Vars): string {
  return paragraphs(template, vars)
    .map((p) => paragraphText(p, vars))
    .join("\n\n");
}

// A full email: the body, the button, the small print, the signature, then
// anything the email adds after it (the job description in an attendee
// invitation). The recruiter's message goes where {{message}} is, or first.
export function renderEmail(
  templates: Templates,
  id: EmailTemplateId,
  vars: Vars,
  extra?: { html: string; text: string },
): RenderedEmail {
  const t = templates.emails[id];
  const info = EMAILS[id];
  const message = info.placeholders.includes("message") ? vars.message?.trim() || null : null;
  const v: Vars = { ...vars, message };
  const body = message && !/\{\{\s*message\s*\}\}/.test(t.body) ? `{{message}}\n\n${t.body}` : t.body;
  const buttonHref = info.buttonLink ? vars[info.buttonLink] : null;
  const showButton = Boolean(t.button && buttonHref && isUrl(buttonHref));
  // The button's link is already written out if the small print includes it.
  const linkInText = info.buttonLink && new RegExp(`\\{\\{\\s*${info.buttonLink}\\s*\\}\\}`).test(`${t.body}\n${t.footer}`);

  const html: string[] = [];
  const text: string[] = [];
  for (const p of paragraphs(body, v)) {
    if (p === "{{message}}" && message) {
      html.push(`<p style="white-space:pre-wrap;border-left:3px solid #12798f;padding-left:12px">${escape(message)}</p>`);
      text.push(message);
    } else {
      html.push(paragraphHtml(p, v));
      text.push(paragraphText(p, v));
    }
  }
  if (showButton) {
    html.push(`<p style="margin:28px 0"><a href="${escape(buttonHref!)}" ${BUTTON}>${escape(t.button)}</a></p>`);
    if (!linkInText) text.push(`${t.button}: ${buttonHref}`);
  } else if (t.button && info.buttonLink) {
    // No link to put on the button (e.g. a reminder whose link can't be recovered).
    html.push(`<p>Use the <strong>${escape(t.button)}</strong> button in your confirmation email.</p>`);
    text.push(`Use the ${t.button} button in your confirmation email.`);
  }
  for (const p of paragraphs(t.footer, v)) {
    html.push(paragraphHtml(p, v, MUTED));
    text.push(paragraphText(p, v));
  }
  const signature = paragraphs(templates.signature, v);
  html.push(...signature.map((p) => paragraphHtml(p, v)));
  text.push(...signature.map((p) => paragraphText(p, v)));
  if (extra) {
    html.push(extra.html);
    text.push(extra.text);
  }

  return {
    subject: fill(keepLines(t.subject, v), v).replace(/\s+/g, " ").trim(),
    bodyHtml: `<div ${WRAP}>\n${html.join("\n")}\n</div>`,
    text: text.join("\n\n"),
  };
}
