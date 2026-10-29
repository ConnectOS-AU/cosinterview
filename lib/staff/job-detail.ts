import "server-only";
import { demoMode } from "../demo";
import { jobAdderGet, jobAdderWriteConfigured } from "./jobadder-api";

// A job as JobAdder's API returns it (GET /jobs/{jobId}), for what the synced
// ja_jobs table doesn't have: the description and the job's recruiters.
// Kept for an hour (10 minutes after a failure); lookups for the same job
// share one request, and at most a few run at once so a page listing every
// active job doesn't flood JobAdder.

type Job = Record<string, unknown>;
type Entry = { job: Job | null; at: number; pending: Promise<Job | null> | null };

const HIT_MS = 60 * 60_000;
const MISS_MS = 10 * 60_000;
const MAX_PARALLEL = 4;

const cache = (globalThis as typeof globalThis & { __cosrecJobDetails?: Map<string, Entry> }).__cosrecJobDetails ??= new Map();

let running = 0;
const waiting: (() => void)[] = [];

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// Demo: job 1003 is someone else's, with the demo recruiter as a recruiter on it.
const DEMO_DETAILS: Record<string, Job> = {
  "1001": { jobId: 1001, recruiters: [] },
  "1002": { jobId: 1002, recruiters: [] },
  "1003": { jobId: 1003, recruiters: [{ userId: 9, firstName: "Demo", lastName: "Recruiter", email: "demo@connectos.co" }] },
};

export async function getJobAdderJob(jobId: string): Promise<Job | null> {
  if (demoMode()) return DEMO_DETAILS[jobId] ?? null;
  if (!/^\d+$/.test(jobId) || !jobAdderWriteConfigured()) return null;

  const cached = cache.get(jobId);
  if (cached?.pending) return cached.pending;
  if (cached && Date.now() - cached.at < (cached.job ? HIT_MS : MISS_MS)) return cached.job;

  const pending = limited(() => jobAdderGet<Job>(`/jobs/${jobId}`)).then(
    (job) => {
      cache.set(jobId, { job, at: Date.now(), pending: null });
      return job;
    },
    (err) => {
      console.error("[jobadder] Job lookup failed", jobId, err);
      // Keep what we had; with nothing, try again in 10 minutes rather than on
      // every page load while JobAdder is failing.
      cache.set(jobId, { job: cached?.job ?? null, at: Date.now(), pending: null });
      return cached?.job ?? null;
    },
  );
  cache.set(jobId, { job: cached?.job ?? null, at: cached?.at ?? 0, pending });
  return pending;
}

// UNVERIFIED: where JobAdder lists a job's recruiters. Any of these fields,
// as a user or a list of users with an email, counts; if a job has none of
// them, its field names are logged once so the right one can be added.
const RECRUITER_FIELDS = ["recruiters", "recruiter", "users", "team", "assignedTo"] as const;
let loggedFields = false;

export function jobRecruiterEmails(job: Job): string[] {
  const emails: string[] = [];
  let found = false;
  for (const field of RECRUITER_FIELDS) {
    const value = job[field];
    if (value === undefined) continue;
    found = true;
    for (const user of Array.isArray(value) ? value : [value]) {
      const email = user && typeof user === "object" ? (user as { email?: unknown }).email : null;
      if (typeof email === "string" && email.includes("@")) emails.push(email.toLowerCase());
    }
  }
  if (!found && !loggedFields) {
    loggedFields = true;
    console.info("[jobadder] No recruiters field on job", job.jobId, "- fields:", Object.keys(job).join(", "));
  }
  return emails;
}

// The jobs (of those given) that list `email` as a recruiter. Waits up to
// `waitMs` for JobAdder; jobs it hasn't answered for by then are left out this
// time and are ready from the cache on the next page load.
export async function jobsWithRecruiter(jobIds: string[], email: string, waitMs = 4_000): Promise<Set<string>> {
  const me = email.toLowerCase();
  const mine = new Set<string>();
  const lookups = jobIds.map((id) =>
    getJobAdderJob(id).then((job) => {
      if (job && jobRecruiterEmails(job).includes(me)) mine.add(id);
    }),
  );
  await Promise.race([Promise.all(lookups), new Promise((resolve) => setTimeout(resolve, waitMs))]);
  return new Set(mine);
}
