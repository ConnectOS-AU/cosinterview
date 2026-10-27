import { DateTime } from "luxon";

// Date/time wording shared by the server pages and the slot picker.

export function formatDay(iso: string, zone: string): string {
  return DateTime.fromISO(iso, { zone }).toFormat("cccc d LLLL");
}

export function formatTime(iso: string, zone: string): string {
  return DateTime.fromISO(iso, { zone }).toFormat("h:mm a").toLowerCase();
}

export function formatZone(zone: string): string {
  return zone.replace(/_/g, " ").split("/").pop() ?? zone;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}
