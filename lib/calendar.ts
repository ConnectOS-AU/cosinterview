import { DateTime } from "luxon";

// "Add to calendar" for candidates: an .ics file (download on the booking page,
// attachment on the confirmation email) and one-click Google / Outlook.com links.

export type CalendarEvent = {
  uid: string;
  title: string;
  description: string;
  start: string;
  end: string;
  url: string;
};

const stamp = (iso: string) => DateTime.fromISO(iso).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
const escape = (text: string) => text.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

export function icsFile(event: CalendarEvent): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ConnectOS//Interviews//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${escape(event.title)}`,
    `DESCRIPTION:${escape(event.description)}`,
    `URL:${event.url}`,
    `LOCATION:${escape(event.url)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${stamp(event.start)}/${stamp(event.end)}`,
    details: event.description,
    location: event.url,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

export function outlookCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: DateTime.fromISO(event.start).toUTC().toISO()!,
    enddt: DateTime.fromISO(event.end).toUTC().toISO()!,
    body: event.description,
    location: event.url,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`;
}
