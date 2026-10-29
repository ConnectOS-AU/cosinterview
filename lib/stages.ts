import { DateTime } from "luxon";

// Which interview a booking is: the recruiter picks it when inviting. Client
// stages can have client attendees (lib/guests.ts). Order matters - it's the
// order they're offered in.

export const STAGES = [
  { key: "screening", label: "Screening" },
  { key: "interview_1", label: "Interview 1" },
  { key: "interview_2", label: "Interview 2" },
  { key: "interview_3", label: "Interview 3" },
  { key: "client_1", label: "Client Interview 1" },
  { key: "client_2", label: "Client Interview 2" },
  { key: "client_3", label: "Client Interview 3" },
  { key: "job_offer", label: "Job Offer" },
] as const;

export type Stage = (typeof STAGES)[number]["key"];

// Extra people on an interview: client attendees (client interviews only)
// and "Other" (any interview - another recruiter, a last-minute addition).
export type GuestRole = "client" | "other";
export const MAX_GUESTS: Record<GuestRole, number> = { client: 5, other: 5 };
export const GUEST_ROLE_LABEL: Record<GuestRole, string> = { client: "Client", other: "Other" };

export function isStage(value: unknown): value is Stage {
  return STAGES.some((s) => s.key === value);
}

export function stageLabel(stage: Stage): string {
  return STAGES.find((s) => s.key === stage)?.label ?? "Interview";
}

export function isClientStage(stage: Stage): boolean {
  return stage.startsWith("client_");
}

// The prefix on every note and JobAdder entry: "[Interview 1 · 30 Oct 2026]".
// The date is the interview's (in Manila time), or the note's if not booked.
export function stagePrefix(stage: Stage, when: string | null, zone = "Asia/Manila"): string {
  const date = when ? DateTime.fromISO(when, { zone }).toFormat("d LLL yyyy") : null;
  return `[${stageLabel(stage)}${date ? ` · ${date}` : ""}]`;
}

// One note as it's shown and written to JobAdder:
// "[Client Interview 1 · 30 Oct 2026] Jane Smith (client): ..."
export function noteLine(prefix: string, note: { body: string; authorName: string | null; authorKind: "recruiter" | GuestRole }): string {
  const who = note.authorName ? `${note.authorName}${note.authorKind === "recruiter" ? "" : ` (${note.authorKind})`}: ` : "";
  return `${prefix} ${who}${note.body}`;
}

// Client attendees join the video call as "<name> (client)" and others as
// "<name> (other)", which is how the recruiter's lobby, attendance and the
// transcription worker tell them from the candidate.
export const guestCallName = (name: string, role: GuestRole) => `${name} (${role})`;

export function parseCallName(displayName: string | null | undefined): { name: string; role: GuestRole | null } {
  const match = /^(.*) \((client|other)\)$/.exec(displayName ?? "");
  return match ? { name: match[1]!, role: match[2] as GuestRole } : { name: displayName ?? "", role: null };
}
