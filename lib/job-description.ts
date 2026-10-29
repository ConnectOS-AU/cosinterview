import "server-only";
import { demoMode } from "./demo";
import { cleanRichHtml } from "./lobby";
import { getJobAdderJob } from "./staff/job-detail";

// The job description candidates can read from the lobby. It isn't in the
// synced ja_jobs table, so it's read from JobAdder's API (GET /jobs/{jobId},
// cached in lib/staff/job-detail.ts). Cleaned like the lobby panels before it's shown.
//
// UNVERIFIED: JobAdder's field name for the description. The first of the
// fields below that holds text is used; if none does, the job's field names
// are logged so the right one can be added.

const FIELDS = ["description", "jobDescription", "summary"] as const;
const MAX_HTML = 60_000;

const DEMO_DESCRIPTION =
  "<h2>About the role</h2><p>Support our client's customers by phone, chat and email, solving problems and keeping every customer happy.</p>" +
  "<h3>What you'll do</h3><ul><li>Answer customer questions and fix account issues</li><li>Log every conversation in the client's helpdesk</li><li>Pass tricky cases to the right team</li></ul>" +
  "<h3>About you</h3><ul><li>2+ years in customer support</li><li>Excellent written and spoken English</li></ul>";

// Plain text from JobAdder becomes paragraphs; HTML is used as it is.
function toHtml(text: string): string {
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  const escape = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escape(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export async function getJobDescription(jobId: string): Promise<string | null> {
  if (demoMode()) return jobId === "1001" ? DEMO_DESCRIPTION : null;
  const job = await getJobAdderJob(jobId);
  if (!job) return null;
  const text = FIELDS.map((f) => job[f]).find((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (!text) {
    console.info("[job description] No description on JobAdder job", jobId, "- fields:", Object.keys(job).join(", "));
    return null;
  }
  return cleanRichHtml(toHtml(text), MAX_HTML) || null;
}
