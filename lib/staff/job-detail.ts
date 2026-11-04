import "server-only";
import { demoMode } from "../demo";
import { jobAdderGet, jobAdderWriteConfigured } from "./jobadder-api";

// A job as JobAdder's API returns it (GET /jobs/{jobId}), for what the synced
// ja_jobs table doesn't have, such as the description. Kept for an hour (10
// minutes after a failure); lookups for the same job share one request, and at
// most a few run at once so as not to flood JobAdder.

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

// The active jobs a person is a recruiter on, owners included. JobAdder filters
// this for us: looking up each job instead takes 160-odd requests, and its rate
// limit starts refusing them after about 30. Kept for 10 minutes per person (a
// minute after a failure, keeping what we had).
const JOBS_MS = 10 * 60_000;
const JOBS_RETRY_MS = 60_000;
const PAGE = 100;

type UserJobs = { ids: Set<string>; until: number; pending: Promise<Set<string>> | null };
type UserIds = { byEmail: Map<string, number>; until: number };
type List<T> = { items?: T[]; totalCount?: number };

const store = globalThis as typeof globalThis & { __cosrecUserJobs?: Map<string, UserJobs>; __cosrecUserIds?: UserIds };
const userJobs = (store.__cosrecUserJobs ??= new Map());

async function jobAdderUserId(email: string): Promise<number | null> {
  if (!store.__cosrecUserIds || store.__cosrecUserIds.until < Date.now()) {
    const { items = [] } = await jobAdderGet<List<{ userId: number; email?: string }>>("/users?limit=500");
    store.__cosrecUserIds = { byEmail: new Map(items.map((u) => [(u.email ?? "").toLowerCase(), u.userId])), until: Date.now() + HIT_MS };
  }
  return store.__cosrecUserIds.byEmail.get(email) ?? null;
}

async function loadRecruiterJobs(email: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const userId = await jobAdderUserId(email);
  if (userId === null) return ids;
  for (let offset = 0; ; offset += PAGE) {
    const { items = [], totalCount = 0 } = await jobAdderGet<List<{ jobId: number }>>(`/jobs?recruiterUserId=${userId}&active=true&limit=${PAGE}&offset=${offset}`);
    for (const job of items) ids.add(String(job.jobId));
    if (items.length === 0 || offset + PAGE >= totalCount) return ids;
  }
}

function recruiterJobs(email: string): Promise<Set<string>> {
  const cached = userJobs.get(email);
  if (cached?.pending) return cached.pending;
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.ids);
  const known = cached?.ids ?? new Set<string>();
  const pending = loadRecruiterJobs(email).then(
    (ids) => {
      userJobs.set(email, { ids, until: Date.now() + JOBS_MS, pending: null });
      return ids;
    },
    (err) => {
      console.error("[jobadder] Recruiter's jobs lookup failed", err);
      userJobs.set(email, { ids: known, until: Date.now() + JOBS_RETRY_MS, pending: null });
      return known;
    },
  );
  userJobs.set(email, { ids: known, until: 0, pending });
  return pending;
}

// The jobs (of those given) that list `email` as a recruiter. Waits up to
// `waitMs` for JobAdder, then shows what's known; the next page load has the rest.
export async function jobsWithRecruiter(jobIds: string[], email: string, waitMs = 4_000): Promise<Set<string>> {
  const me = email.toLowerCase();
  if (demoMode()) {
    const listed = (id: string) => (DEMO_DETAILS[id]?.recruiters as { email: string }[] | undefined)?.some((r) => r.email === me);
    return new Set(jobIds.filter(listed));
  }
  if (!jobAdderWriteConfigured()) return new Set();
  const known = userJobs.get(me)?.ids ?? new Set<string>();
  const mine = await Promise.race([recruiterJobs(me), new Promise<Set<string>>((resolve) => setTimeout(() => resolve(known), waitMs))]);
  return new Set(jobIds.filter((id) => mine.has(id)));
}
