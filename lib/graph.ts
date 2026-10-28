import "server-only";
import { DateTime } from "luxon";
import type { TimeRange } from "./types";

// Microsoft Graph with app-only (client credentials) auth. Needs the
// Calendars.ReadWrite and Mail.Send application permissions, limited to
// recruiter mailboxes with an application access policy.

export function graphConfigured(): boolean {
  return Boolean(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID!,
      client_secret: process.env.MS_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Graph token request failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.value;
}

async function graph<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.timezone="UTC"',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Graph ${path} failed: ${res.status} ${await res.text()}`);
  // sendMail, cancel and delete answer 202/204 with no body.
  return (res.status === 202 || res.status === 204 ? undefined : await res.json()) as T;
}

type ScheduleResponse = {
  value: { scheduleItems?: { status: string; start: { dateTime: string }; end: { dateTime: string } }[] }[];
};

// Busy blocks (anything not 'free') on the recruiter's Outlook calendar.
export async function getBusy(calendarEmail: string, from: DateTime, to: DateTime): Promise<TimeRange[]> {
  const fmt = (d: DateTime) => d.toUTC().toFormat("yyyy-LL-dd'T'HH:mm:ss");
  const json = await graph<ScheduleResponse>(`/users/${encodeURIComponent(calendarEmail)}/calendar/getSchedule`, {
    schedules: [calendarEmail],
    startTime: { dateTime: fmt(from), timeZone: "UTC" },
    endTime: { dateTime: fmt(to), timeZone: "UTC" },
    availabilityViewInterval: 30,
  });
  return (json.value[0]?.scheduleItems ?? [])
    .filter((item) => item.status !== "free")
    .map((item) => ({
      start: DateTime.fromISO(item.start.dateTime, { zone: "utc" }).toISO()!,
      end: DateTime.fromISO(item.end.dateTime, { zone: "utc" }).toISO()!,
    }));
}

// The recruiter's own Outlook entry for a booked interview. No attendees: the
// candidate gets their own confirmation email with a calendar file instead, so
// this entry can link to the recruiter's interview screen.
export async function createInterviewEvent(
  calendarEmail: string,
  event: { subject: string; bodyHtml: string; start: string; end: string; link: string },
): Promise<string> {
  const json = await graph<{ id: string }>(`/users/${encodeURIComponent(calendarEmail)}/events`, {
    subject: event.subject,
    body: { contentType: "HTML", content: event.bodyHtml },
    start: { dateTime: DateTime.fromISO(event.start).toUTC().toFormat("yyyy-LL-dd'T'HH:mm:ss"), timeZone: "UTC" },
    end: { dateTime: DateTime.fromISO(event.end).toUTC().toFormat("yyyy-LL-dd'T'HH:mm:ss"), timeZone: "UTC" },
    location: { displayName: "COSInterview", locationUri: event.link },
    isOnlineMeeting: false,
    isReminderOn: true,
    reminderMinutesBeforeStart: 15,
  });
  return json.id;
}

// Removes the recruiter's Outlook entry. Entries made before candidates got
// their own confirmation had the candidate as an attendee; deleting those as the
// organizer still sends the candidate Outlook's cancellation.
export async function deleteInterviewEvent(calendarEmail: string, eventId: string): Promise<void> {
  await graph<void>(`/users/${encodeURIComponent(calendarEmail)}/events/${encodeURIComponent(eventId)}`, undefined, "DELETE");
}

export type MailAttachment = { name: string; contentType: string; content: string };

// Sends an email from the recruiter's own mailbox (it appears in their Sent Items).
export async function sendMailAs(
  fromEmail: string,
  mail: { to: { name: string; email: string }; subject: string; bodyHtml: string; attachments?: MailAttachment[] },
): Promise<void> {
  await graph<void>(`/users/${encodeURIComponent(fromEmail)}/sendMail`, {
    message: {
      subject: mail.subject,
      body: { contentType: "HTML", content: mail.bodyHtml },
      toRecipients: [{ emailAddress: { address: mail.to.email, name: mail.to.name } }],
      attachments: (mail.attachments ?? []).map((a) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: a.name,
        contentType: a.contentType,
        contentBytes: Buffer.from(a.content, "utf8").toString("base64"),
      })),
    },
    saveToSentItems: true,
  });
}
