import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { listReviewSummaries } from "@/lib/candidate-review";
import { mailConfigured } from "@/lib/mail";
import { requireRecruiter } from "@/lib/staff/auth";
import { jobsWithRecruiter } from "@/lib/staff/job-detail";
import { getJob, listActiveJobs, listApplications } from "@/lib/staff/jobadder";
import { stagesForJob, type CandidateStage } from "@/lib/staff/repo";
import { STATUS_BADGE } from "@/lib/staff/status";
import { nextStage, stageLabel, STAGES } from "@/lib/stages";
import type { JobAdderApplication, JobAdderJob } from "@/lib/types";
import { CandidatePicker } from "./candidate-picker";
import type { Standing } from "./candidate-standing";
import { ClientSelect } from "./client-select";
import { ProgressBoard, type BoardCandidate, type BoardJob } from "./progress-board";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ job?: string; q?: string; client?: string }> };

export default async function NewInterviewPage({ searchParams }: Props) {
  const { job: jobId, q = "", client = "" } = await searchParams;
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div>
        <Link href={jobId ? "/r/interviews/new" : "/r"} className="text-xs font-medium text-neutral-500 hover:text-neutral-800">
          ← {jobId ? "Choose another job" : "Interviews"}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900">New interview</h1>
      </div>
      {jobId ? <ChooseCandidates jobId={jobId} /> : <ChooseJob q={q} client={client} />}
    </main>
  );
}

async function ChooseJob({ q, client }: { q: string; client: string }) {
  const { recruiter } = await requireRecruiter();
  // Every active job (at most 500), so the client list stays whole while
  // searching; the search and client filter apply here.
  const active = await listActiveJobs("");
  const clients = [...new Set(active.map((j) => j.companyName?.trim()).filter((c): c is string => Boolean(c)))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  const term = q.trim().toLowerCase();
  const jobs = active.filter(
    (j) => (!client || j.companyName?.trim() === client) && (!term || `${j.title} ${j.companyName ?? ""}`.toLowerCase().includes(term)),
  );
  const filtered = Boolean(term || client);
  const email = recruiter.calendarEmail.toLowerCase();
  // "Your jobs": ones you own in JobAdder, or where you're one of the job's
  // recruiters (read from JobAdder, see lib/staff/job-detail.ts).
  const owned = new Set(jobs.filter((j) => j.ownerEmail?.toLowerCase() === email).map((j) => j.jobId));
  const recruiting = await jobsWithRecruiter(
    jobs.filter((j) => !owned.has(j.jobId)).map((j) => j.jobId),
    email,
  );
  const roles = new Map<string, string>();
  for (const id of owned) roles.set(id, "Owner");
  for (const id of recruiting) roles.set(id, "Recruiter");
  const own = jobs.filter((j) => roles.has(j.jobId));
  const others = jobs.filter((j) => !roles.has(j.jobId));
  const loaded = await Promise.all(
    own.map(async (job) => {
      const [applications, stages] = await Promise.all([listApplications(job.jobId), stagesForJob(job.jobId)]);
      return { job, applications, stages };
    }),
  );
  const reviews = await reviewsFor(loaded.map((l) => l.stages));
  const board: BoardJob[] = loaded.map(({ job, applications, stages }) => ({
    jobId: job.jobId,
    title: job.title,
    companyName: job.companyName,
    role: roles.get(job.jobId)!,
    candidates: applications.flatMap((a) => {
      const interviews = stages.get(a.candidateId) ?? [];
      return awaitingNextStep(a, interviews, standingOf(interviews, reviews, recruiter.id));
    }),
  }));

  return (
    <>
      <form className="flex max-w-3xl flex-wrap gap-2" action="/r/interviews/new">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search job title or client"
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <ClientSelect clients={clients} value={client} />
        <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          Search
        </button>
        {filtered && (
          <Link href="/r/interviews/new" className="self-center text-xs font-medium text-neutral-600 underline hover:text-neutral-950">
            Clear
          </Link>
        )}
      </form>
      <p className="text-sm text-neutral-500">Only open and on-hold jobs are shown.</p>
      <section>
        <h2 className="text-sm font-semibold text-neutral-700">Your jobs</h2>
        <p className="mb-2 text-sm text-neutral-500">Candidates waiting for a next step. Tick them to invite them to their next stage or one you choose.</p>
        <ProgressBoard
          jobs={board}
          canEmail={mailConfigured()}
          emptyText={filtered ? "None of your jobs match." : "No open jobs where you're the owner or a recruiter."}
        />
      </section>
      <JobList title="Other active jobs" jobs={others} empty="No other jobs match." />
    </>
  );
}

// Someone with no interview open on this job, and a stage still ahead of them.
function awaitingNextStep(application: JobAdderApplication, interviews: CandidateStage[], standing: Standing): BoardCandidate[] {
  // A stage they missed is still ahead of them.
  const next = nextStage(interviews.filter((i) => i.status !== "no_show"));
  if (!next || interviews.some((i) => i.status === "invited" || i.status === "booked" || i.status === "in_progress")) return [];
  const latest = interviews.reduce<CandidateStage | null>((a, b) => (!a || stageOrder(b) > stageOrder(a) ? b : a), null);
  return [
    {
      candidateId: application.candidateId,
      name: application.candidateName,
      email: application.candidateEmail,
      jobAdderStage: [application.statusName, application.stage].filter(Boolean).join(" · ") || null,
      unsubscribed: application.unsubscribed,
      last: latest && `${stageLabel(latest.stage)} ${STATUS_BADGE[latest.status].label.toLowerCase()}`,
      next,
      completed: interviews.filter((i) => i.status === "completed").map((i) => i.stage),
      standing,
    },
  ];
}

type Reviews = Awaited<ReturnType<typeof listReviewSummaries>>;

function reviewsFor(jobs: Map<string, CandidateStage[]>[]): Promise<Reviews> {
  return listReviewSummaries(jobs.flatMap((stages) => [...stages.values()].flat().map((i) => i.bookingId)));
}

// Their furthest interview with a score, and the furthest one this recruiter can
// open: the overview page is only for the interview's own recruiter.
function standingOf(interviews: CandidateStage[], reviews: Reviews, recruiterId: string): Standing {
  const latestFirst = [...interviews].sort((a, b) => stageOrder(b) - stageOrder(a) || Number(a.status === "no_show") - Number(b.status === "no_show"));
  const scores = latestFirst.map((i) => {
    const review = reviews.get(i.bookingId);
    return review?.afterInterview ?? review?.likelihood ?? null;
  });
  return {
    score: scores.find((s) => s !== null) ?? null,
    overviewId: latestFirst.find((i) => i.recruiterId === recruiterId)?.bookingId ?? null,
  };
}

const stageOrder = (entry: CandidateStage) => STAGES.findIndex((s) => s.key === entry.stage);

function JobList({ title, jobs, empty }: { title: string; jobs: JobAdderJob[]; empty: string }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">{title}</h2>
      {jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          {jobs.map((job) => (
            <li key={job.jobId}>
              <Link
                href={`/r/interviews/new?job=${job.jobId}`}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-neutral-50"
              >
                <span>
                  <span className="font-medium text-neutral-900">{job.title}</span>
                  {job.companyName && <span className="text-neutral-500"> · {job.companyName}</span>}
                </span>
                <span className="text-xs text-neutral-500">
                  {job.statusName}
                  {job.ownerName && ` · ${job.ownerName}`}
                  {job.updatedAt && ` · updated ${DateTime.fromISO(job.updatedAt).toRelative()}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function ChooseCandidates({ jobId }: { jobId: string }) {
  const { recruiter } = await requireRecruiter();
  const job = await getJob(jobId);
  if (!job) notFound();
  const [applications, stages] = await Promise.all([listApplications(job.jobId), stagesForJob(job.jobId)]);
  const reviews = await reviewsFor([stages]);

  return (
    <>
      <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
        <p className="font-medium text-neutral-900">{job.title}</p>
        <p className="text-sm text-neutral-500">
          {job.companyName ?? "No client"} · JobAdder job {job.jobId}
          {job.ownerName && ` · ${job.ownerName}`}
        </p>
      </div>
      <CandidatePicker
        jobId={job.jobId}
        canEmail={mailConfigured()}
        candidates={applications.map((a) => ({
          candidateId: a.candidateId,
          name: a.candidateName,
          email: a.candidateEmail,
          stage: [a.statusName, a.stage].filter(Boolean).join(" · ") || null,
          unsubscribed: a.unsubscribed,
          interviews: stages.get(a.candidateId) ?? [],
          standing: standingOf(stages.get(a.candidateId) ?? [], reviews, recruiter.id),
        }))}
      />
    </>
  );
}
