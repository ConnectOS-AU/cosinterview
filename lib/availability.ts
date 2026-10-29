import { DateTime, Interval } from "luxon";
import type { TimeRange } from "./types";

// Booking rules, in the recruiter's own time zone. Kept in one place so they're
// easy to change (and later to move onto the recruiter profile).
export const BOOKING_RULES = {
  dayStartHour: 9,
  dayEndHour: 17,
  stepMins: 30,
  // Same-day bookings are fine; this just stops a candidate booking a time
  // that starts before the recruiter could see it.
  minNoticeHours: 1,
  daysAhead: 14,
};

export function bookingWindow(now: DateTime = DateTime.utc()): { from: DateTime; to: DateTime } {
  return { from: now, to: now.plus({ days: BOOKING_RULES.daysAhead + 1 }) };
}

// Start times (UTC ISO strings) the candidate can pick: weekdays inside the
// recruiter's working hours, with enough notice, not overlapping anything busy.
export function freeSlots({
  timezone,
  durationMins,
  busy,
  now = DateTime.utc(),
}: {
  timezone: string;
  durationMins: number;
  busy: TimeRange[];
  now?: DateTime;
}): string[] {
  const busyIntervals = busy
    .map((b) => Interval.fromDateTimes(DateTime.fromISO(b.start), DateTime.fromISO(b.end)))
    .filter((i) => i.isValid);
  const earliest = now.plus({ hours: BOOKING_RULES.minNoticeHours });
  const slots: string[] = [];

  let day = now.setZone(timezone).startOf("day");
  for (let i = 0; i <= BOOKING_RULES.daysAhead; i++, day = day.plus({ days: 1 })) {
    if (day.weekday > 5) continue; // Saturday, Sunday
    const lastStart = day.set({ hour: BOOKING_RULES.dayEndHour }).minus({ minutes: durationMins });
    for (
      let start = day.set({ hour: BOOKING_RULES.dayStartHour });
      start <= lastStart;
      start = start.plus({ minutes: BOOKING_RULES.stepMins })
    ) {
      if (start < earliest) continue;
      const slot = Interval.after(start, { minutes: durationMins });
      if (busyIntervals.some((b) => b.overlaps(slot))) continue;
      slots.push(start.toUTC().toISO()!);
    }
  }
  return slots;
}
