import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { mailConfigured } from "@/lib/mail";
import { requireRecruiter } from "@/lib/staff/auth";
import { getJob, listActiveJobs, listApplications } from "@/lib/staff/jobadder";
import { invitesForJob } from "@/lib/staff/repo";
import { STATUS_BADGE } from "@/lib/staff/status";
import type { JobAdderJob } from "@/lib/types";
import { CandidatePicker } from "./candidate-picker";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ job?: string; q?: string }> };

export default async function NewInterviewPage({ searchParams }: Props) {
  const { job: jobId, q = "" } = await searchParams;
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div>
        <Link href={jobId ? "/r/interviews/new" : "/r"} className="text-xs font-medium text-neutral-500 hover:text-neutral-800">
          ← {jobId ? "Choose another job" : "Interviews"}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900">New interview</h1>
      </div>
      {jobId ? <ChooseCandidates jobId={jobId} /> : <ChooseJob q={q} />}
    </main>
  );
}

async function ChooseJob({ q }: { q: string }) {
  const { recruiter } = await requireRecruiter();
  const jobs = await listActiveJobs(q);
  const mine = (j: JobAdderJob) => j.ownerEmail?.toLowerCase() === recruiter.calendarEmail.toLowerCase();
  const own = jobs.filter(mine);
  const others = jobs.filter((j) => !mine(j));

  return (
    <>
      <form className="flex max-w-lg gap-2" action="/r/interviews/new">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search job title or client"
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <button type="submit" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          Search
        </button>
      </form>
      <p className="text-sm text-neutral-500">Pick the JobAdder job you&apos;re interviewing for. Only open and on-hold jobs are shown.</p>
      <JobList title="Your jobs" jobs={own} empty={q ? "None of your jobs match." : "No open jobs owned by you."} />
      <JobList title="Other active jobs" jobs={others} empty="No other jobs match." />
    </>
  );
}

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
  const [applications, existing] = await Promise.all([listApplications(job.jobId), invitesForJob(recruiter.id, job.jobId)]);

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
        candidates={applications.map((a) => {
          const status = existing.get(a.candidateId);
          return {
            candidateId: a.candidateId,
            name: a.candidateName,
            email: a.candidateEmail,
            stage: [a.statusName, a.stage].filter(Boolean).join(" · ") || null,
            unsubscribed: a.unsubscribed,
            invitedLabel: status ? STATUS_BADGE[status].label : null,
          };
        })}
      />
    </>
  );
}
