import "server-only";
import { DEMO_APPLICATIONS, DEMO_JOBS, demoMode } from "../demo";
import { supabaseAdmin } from "../supabase/admin";
import type { JobAdderApplication, JobAdderJob } from "../types";

// Reads the JobAdder data that's already synced into Supabase (ja_jobs,
// ja_applications). Nothing here calls JobAdder directly.

type JobRow = {
  job_id: number;
  job_title: string | null;
  company_name: string | null;
  owner_email: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  status_name: string | null;
  updated_at: string | null;
};

function toJob(row: JobRow): JobAdderJob {
  return {
    jobId: String(row.job_id),
    title: row.job_title ?? `Job ${row.job_id}`,
    companyName: row.company_name,
    ownerEmail: row.owner_email,
    ownerName: [row.owner_first_name, row.owner_last_name].filter(Boolean).join(" ") || null,
    statusName: row.status_name,
    updatedAt: row.updated_at,
  };
}

const JOB_COLUMNS = "job_id, job_title, company_name, owner_email, owner_first_name, owner_last_name, status_name, updated_at";

// Active jobs (Open, On hold), newest first. `search` matches title or client.
export async function listActiveJobs(search: string): Promise<JobAdderJob[]> {
  const term = search.trim().toLowerCase();
  if (demoMode()) {
    return DEMO_JOBS.filter((j) => !term || `${j.title} ${j.companyName ?? ""}`.toLowerCase().includes(term));
  }
  let query = supabaseAdmin()
    .from("ja_jobs")
    .select(JOB_COLUMNS)
    .eq("status_active", true)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (term) {
    // Strip characters PostgREST's or() syntax treats specially.
    const safe = term.replace(/[,()*%\\]/g, " ").trim();
    if (safe) query = query.or(`job_title.ilike.*${safe}*,company_name.ilike.*${safe}*`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Job list failed: ${error.message}`);
  return (data ?? []).map((row) => toJob(row as JobRow));
}

export async function getJob(jobId: string): Promise<JobAdderJob | null> {
  if (demoMode()) return DEMO_JOBS.find((j) => j.jobId === jobId) ?? null;
  if (!/^\d+$/.test(jobId)) return null;
  const { data, error } = await supabaseAdmin().from("ja_jobs").select(JOB_COLUMNS).eq("job_id", jobId).maybeSingle();
  if (error) throw new Error(`Job lookup failed: ${error.message}`);
  return data ? toJob(data as JobRow) : null;
}

// Every application on the job that's still active in JobAdder.
export async function listApplications(jobId: string): Promise<JobAdderApplication[]> {
  if (demoMode()) return DEMO_APPLICATIONS[jobId] ?? [];
  const { data, error } = await supabaseAdmin()
    .from("ja_applications")
    .select(
      "application_id, candidate_id, candidate_full_name, candidate_first_name, candidate_last_name, candidate_email, candidate_unsubscribed, status_name, workflow_stage, updated_at",
    )
    .eq("job_id", jobId)
    .eq("status_active", true)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Application list failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    applicationId: String(row.application_id),
    candidateId: String(row.candidate_id),
    candidateName:
      row.candidate_full_name ||
      [row.candidate_first_name, row.candidate_last_name].filter(Boolean).join(" ") ||
      `Candidate ${row.candidate_id}`,
    candidateEmail: row.candidate_email,
    statusName: row.status_name,
    stage: row.workflow_stage,
    unsubscribed: Boolean(row.candidate_unsubscribed),
    updatedAt: row.updated_at,
  }));
}
