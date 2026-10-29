import "server-only";
import mammoth from "mammoth";
import sanitizeHtml from "sanitize-html";
import { getJobDescription } from "./job-description";
import { jobAdderGet, jobAdderGetFile, jobAdderWriteConfigured } from "./staff/jobadder-api";
import { supabaseAdmin } from "./supabase/admin";
import type { InviteRecord } from "./types";

// Everything the pre-interview review reads about a candidate:
// - the job description (JobAdder API, lib/job-description.ts),
// - their resume (JobAdder API, candidate attachments),
// - the team's JobAdder notes about them (synced ja_notes),
// - their application answers: LinkedIn link, salary (synced ja_applications_custom_fields).
// LinkedIn itself is never fetched - it needs a sign-in and doesn't allow
// automated reading - so only the link is passed on for the interviewer.
//
// UNVERIFIED: JobAdder's attachment endpoints (GET /candidates/{id}/attachments
// and .../attachments/{attachmentId}) and their field names. When no resume is
// found, the attachment fields are logged so the matching can be adjusted.

const MAX_RESUME_BYTES = 15 * 1024 * 1024;
const MAX_RESUME_TEXT = 60_000;
const MAX_NOTES = 40;
const MAX_NOTE_CHARS = 3_000;

export type Resume =
  | { kind: "pdf"; fileName: string; base64: string }
  | { kind: "text"; fileName: string; text: string };

export type ReviewInputs = {
  jobDescription: string | null;
  resume: Resume | null;
  // Why there's no resume, for the overview page ("No resume on JobAdder", ...).
  resumeProblem: string | null;
  notes: { date: string; author: string | null; type: string | null; job: string | null; text: string }[];
  application: { linkedinUrl: string | null; expectedSalary: string | null; currentSalary: string | null };
};

export function htmlToText(html: string): string {
  const spaced = html.replace(/<\/(p|div|li|h[1-6]|tr)>|<br\s*\/?>/gi, "$&\n");
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function gatherReviewInputs(invite: InviteRecord): Promise<ReviewInputs> {
  const [jobHtml, resumeResult, notes, application] = await Promise.all([
    getJobDescription(invite.interview.jobadderJobId),
    findResume(invite.jobadderCandidateId),
    candidateNotes(invite.jobadderCandidateId),
    applicationAnswers(invite.jobadderApplicationId),
  ]);
  return {
    jobDescription: jobHtml ? htmlToText(jobHtml) : null,
    resume: resumeResult.resume,
    resumeProblem: resumeResult.problem,
    notes,
    application,
  };
}

// --- Resume -------------------------------------------------------------------

type Attachment = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");

function attachmentId(a: Attachment): string {
  return str(a.attachmentId ?? a.id);
}
function attachmentName(a: Attachment): string {
  return str(a.fileName ?? a.name ?? a.filename);
}
function attachmentKind(a: Attachment): string {
  return `${str(a.attachmentType)} ${str(a.type)} ${str(a.category)}`.toLowerCase();
}
function attachmentDate(a: Attachment): number {
  return Date.parse(str(a.createdAt ?? a.dateCreated ?? a.updatedAt ?? a.dateUpdated)) || 0;
}

const READABLE = /\.(pdf|docx|txt)$/i;

async function findResume(candidateId: string): Promise<{ resume: Resume | null; problem: string | null }> {
  if (!/^\d+$/.test(candidateId) || !jobAdderWriteConfigured()) return { resume: null, problem: "JobAdder isn't connected." };
  let list: Attachment[];
  try {
    const res = await jobAdderGet<{ items?: Attachment[] } | Attachment[]>(`/candidates/${candidateId}/attachments`);
    list = Array.isArray(res) ? res : (res.items ?? []);
  } catch (err) {
    console.error("[review] Attachment list failed", candidateId, err);
    return { resume: null, problem: "Couldn't read the candidate's attachments from JobAdder." };
  }

  // Newest resume first; otherwise the newest file that looks like a resume.
  const byDate = [...list].sort((a, b) => attachmentDate(b) - attachmentDate(a));
  const pick =
    byDate.find((a) => /resume|cv/.test(attachmentKind(a)) && READABLE.test(attachmentName(a))) ??
    byDate.find((a) => /resume|cv/i.test(attachmentName(a)) && READABLE.test(attachmentName(a))) ??
    byDate.find((a) => /resume|cv/.test(attachmentKind(a)));
  if (!pick || !attachmentId(pick)) {
    console.info(
      "[review] No resume found for candidate",
      candidateId,
      "-",
      list.length,
      "attachments, fields:",
      list[0] ? Object.keys(list[0]).join(", ") : "(none)",
    );
    return { resume: null, problem: list.length ? "No resume among the candidate's JobAdder attachments." : "No resume on JobAdder." };
  }

  const fileName = attachmentName(pick) || "resume";
  try {
    const file = await jobAdderGetFile(`/candidates/${candidateId}/attachments/${encodeURIComponent(attachmentId(pick))}`, MAX_RESUME_BYTES);
    const isPdf = file.contentType === "application/pdf" || /\.pdf$/i.test(fileName) || file.bytes.subarray(0, 5).toString() === "%PDF-";
    if (isPdf) return { resume: { kind: "pdf", fileName, base64: file.bytes.toString("base64") }, problem: null };
    if (/\.docx$/i.test(fileName) || file.contentType.includes("wordprocessingml")) {
      const { value } = await mammoth.extractRawText({ buffer: file.bytes });
      return textResume(fileName, value);
    }
    if (/\.txt$/i.test(fileName) || file.contentType.startsWith("text/")) return textResume(fileName, file.bytes.toString("utf8"));
    return { resume: null, problem: `The resume (${fileName}) is in a format that can't be read automatically - PDF or Word (.docx) only.` };
  } catch (err) {
    console.error("[review] Resume download failed", candidateId, fileName, err);
    return { resume: null, problem: `Couldn't download the resume (${fileName}) from JobAdder.` };
  }
}

function textResume(fileName: string, text: string): { resume: Resume | null; problem: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { resume: null, problem: `The resume (${fileName}) has no readable text - it may be a scanned image.` };
  return { resume: { kind: "text", fileName, text: trimmed.slice(0, MAX_RESUME_TEXT) }, problem: null };
}

// --- JobAdder notes and application answers ---------------------------------

async function candidateNotes(candidateId: string): Promise<ReviewInputs["notes"]> {
  const { data, error } = await supabaseAdmin()
    .from("ja_notes")
    .select("note_text, subject, type, job_title, created_by_name, created_at")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(MAX_NOTES);
  if (error) {
    console.error("[review] JobAdder notes lookup failed", candidateId, error.message);
    return [];
  }
  return (data ?? [])
    .map((n) => ({
      date: (n.created_at as string | null)?.slice(0, 10) ?? "",
      author: n.created_by_name as string | null,
      type: n.type as string | null,
      job: n.job_title as string | null,
      text: htmlToText([n.subject, n.note_text].filter(Boolean).join(" - ")).slice(0, MAX_NOTE_CHARS),
    }))
    // COSInterview's own activity notes (invites, bookings, earlier overviews)
    // say nothing about the candidate.
    .filter((n) => n.text && !/COSInterview/.test(n.text));
}

async function applicationAnswers(applicationId: string | null): Promise<ReviewInputs["application"]> {
  const empty = { linkedinUrl: null, expectedSalary: null, currentSalary: null };
  if (!applicationId) return empty;
  const { data, error } = await supabaseAdmin()
    .from("ja_applications_custom_fields")
    .select("linkedin_profile_link, expected_salary, current_salary")
    .eq("application_id", applicationId)
    .maybeSingle();
  if (error) {
    console.error("[review] Application answers lookup failed", applicationId, error.message);
    return empty;
  }
  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);
  const linkedin = clean(data?.linkedin_profile_link);
  return {
    linkedinUrl: linkedin && /linkedin\.com\//i.test(linkedin) ? (linkedin.startsWith("http") ? linkedin : `https://${linkedin}`) : null,
    expectedSalary: clean(data?.expected_salary),
    currentSalary: clean(data?.current_salary),
  };
}
