import "server-only";
import { DateTime } from "luxon";
import { demoInvites, demoMode } from "./demo";
import type { Stage } from "./stages";
import { supabaseAdmin } from "./supabase/admin";
import type { InviteRecord } from "./types";

// When the candidate reached the lobby, against the booked start time: early,
// on time, late or a no-show. The first visit to the interview room counts,
// from an hour before the start (earlier than that they're only looking at
// the page). Kept on the booking (candidate_arrived_at); recruiters only.

const ARRIVAL_COUNTS_FROM_MINS = 60;
const ON_TIME_MINS = 2;

export type ArrivalOutcome = "early" | "on_time" | "late" | "no_show";
export type Arrival = {
  bookingId: string;
  stage: Stage;
  jobTitle: string | null;
  slotStart: string;
  arrivedAt: string | null;
  // Minutes after the start (negative when early). Null for a no-show.
  minutes: number | null;
  outcome: ArrivalOutcome;
};

const store = globalThis as typeof globalThis & { __cosrecArrivals?: Map<string, string> };

// Only the first arrival counts. Never fails the candidate's way into the room.
export async function recordArrival(invite: InviteRecord): Promise<void> {
  if (!invite.slotStart) return;
  const now = new Date().toISOString();
  if (demoMode()) {
    const arrivals = (store.__cosrecArrivals ??= new Map());
    if (!arrivals.has(invite.bookingId)) arrivals.set(invite.bookingId, now);
    return;
  }
  if (DateTime.fromISO(invite.slotStart).minus({ minutes: ARRIVAL_COUNTS_FROM_MINS }) > DateTime.utc()) return;
  const { error } = await supabaseAdmin().from("cos_recruitment_bookings").update({ candidate_arrived_at: now }).eq("id", invite.bookingId).is("candidate_arrived_at", null);
  if (error) console.error("[arrival]", invite.bookingId, error.message);
}

function toArrival(b: { bookingId: string; stage: Stage; jobTitle: string | null; slotStart: string; arrivedAt: string | null; noShow: boolean }): Arrival | null {
  // The recruiter's no-show stands, even if the candidate opened the lobby.
  if (b.noShow) return { ...b, minutes: null, outcome: "no_show" };
  if (!b.arrivedAt) return null;
  const minutes = Math.round(DateTime.fromISO(b.arrivedAt).diff(DateTime.fromISO(b.slotStart), "minutes").minutes);
  return { ...b, minutes, outcome: minutes < -ON_TIME_MINS ? "early" : minutes > ON_TIME_MINS ? "late" : "on_time" };
}

// Every interview this candidate has reached or missed, on any job, oldest first.
export async function candidateArrivals(candidateId: string): Promise<Arrival[]> {
  if (demoMode()) {
    return demoInvites()
      .filter((i) => i.jobadderCandidateId === candidateId && i.slotStart)
      .flatMap((i) => {
        const arrival = toArrival({
          bookingId: i.bookingId,
          stage: i.interview.stage,
          jobTitle: i.interview.jobTitle,
          slotStart: i.slotStart!,
          arrivedAt: store.__cosrecArrivals?.get(i.bookingId) ?? null,
          noShow: i.status === "no_show",
        });
        return arrival ? [arrival] : [];
      })
      .sort((a, b) => a.slotStart.localeCompare(b.slotStart));
  }
  const { data, error } = await supabaseAdmin()
    .from("cos_recruitment_bookings")
    .select("id, slot_start, status, candidate_arrived_at, interview:cos_recruitment_interviews!inner(stage, job_title)")
    .eq("jobadder_candidate_id", candidateId)
    .not("slot_start", "is", null)
    .order("slot_start");
  if (error) throw new Error(`Loading arrivals failed: ${error.message}`);
  return (data ?? []).flatMap((b) => {
    const interview = (Array.isArray(b.interview) ? b.interview[0] : b.interview) as { stage: Stage; job_title: string | null };
    const arrival = toArrival({
      bookingId: b.id as string,
      stage: interview.stage,
      jobTitle: interview.job_title,
      slotStart: b.slot_start as string,
      arrivedAt: b.candidate_arrived_at as string | null,
      noShow: b.status === "no_show",
    });
    return arrival ? [arrival] : [];
  });
}

export function arrivalLabel(a: Arrival): string {
  if (a.outcome === "no_show") return "No-show";
  if (a.outcome === "on_time") return "On time";
  const mins = Math.abs(a.minutes!);
  return `${mins} minute${mins === 1 ? "" : "s"} ${a.outcome}`;
}

// The line for JobAdder and the post-interview overview.
export function arrivalText(a: Arrival, zone: string): string {
  const time = (iso: string) => DateTime.fromISO(iso, { zone }).toFormat("h:mm a");
  if (a.outcome === "no_show") return `Lobby arrival: no-show for the ${time(a.slotStart)} start${a.arrivedAt ? `, though the lobby was opened at ${time(a.arrivedAt)}` : ""}.`;
  if (a.outcome === "on_time") return `Lobby arrival: on time - joined at ${time(a.arrivedAt!)} for the ${time(a.slotStart)} start.`;
  return `Lobby arrival: ${arrivalLabel(a)} - joined at ${time(a.arrivedAt!)} for the ${time(a.slotStart)} start.`;
}

// A plain-English trend across their interviews. Null until there are two.
export function arrivalTrend(arrivals: Arrival[]): { text: string; concern: boolean } | null {
  const total = arrivals.length;
  if (total < 2) return null;
  const count = (o: ArrivalOutcome) => arrivals.filter((a) => a.outcome === o).length;
  const late = count("late");
  const noShows = count("no_show");
  const missed = [late && `late to ${late}`, noShows && `missed ${noShows}`].filter(Boolean).join(" and ");
  if (!missed) return { text: `On time or early for all ${total} interviews.`, concern: false };

  const lastThree = arrivals.slice(-3).map((a) => a.minutes);
  const slipping = lastThree.length === 3 && lastThree.every((m) => m !== null) && lastThree[0]! < lastThree[1]! && lastThree[1]! < lastThree[2]!;
  const pattern = late + noShows >= 2;
  return {
    text: `${pattern ? "Pattern to raise" : "One-off so far"}: ${missed} of ${total} interviews.${slipping ? " Arriving later each time." : ""}`,
    concern: pattern,
  };
}
