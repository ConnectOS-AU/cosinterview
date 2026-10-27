import "server-only";
import { DateTime } from "luxon";
import type { TimeRange } from "./types";

// Microsoft Graph with app-only (client credentials) auth. Needs the
// Calendars.ReadWrite application permission, ideally limited to recruiter
// mailboxes with an application access policy.

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

async function graph<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      Prefer: 'outlook.timezone="UTC"',
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Graph ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
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

// Puts the interview in the recruiter's calendar with the candidate as an
// attendee, so Outlook also emails the candidate an invitation.
export async function createInterviewEvent(
  calendarEmail: string,
  event: {
    subject: string;
    bodyHtml: string;
    start: string;
    end: string;
    joinUrl: string;
    candidate: { name: string; email: string };
  },
): Promise<string> {
  const json = await graph<{ id: string }>(`/users/${encodeURIComponent(calendarEmail)}/events`, {
    subject: event.subject,
    body: { contentType: "HTML", content: event.bodyHtml },
    start: { dateTime: DateTime.fromISO(event.start).toUTC().toFormat("yyyy-LL-dd'T'HH:mm:ss"), timeZone: "UTC" },
    end: { dateTime: DateTime.fromISO(event.end).toUTC().toFormat("yyyy-LL-dd'T'HH:mm:ss"), timeZone: "UTC" },
    location: { displayName: "ConnectOS video interview", locationUri: event.joinUrl },
    attendees: [{ emailAddress: { address: event.candidate.email, name: event.candidate.name }, type: "required" }],
    isOnlineMeeting: false,
    allowNewTimeProposals: false,
  });
  return json.id;
}
