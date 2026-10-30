import "server-only";
import { demoMode } from "./demo";
import { jobAdderGet, jobAdderGetFile, jobAdderWriteConfigured } from "./staff/jobadder-api";

// A candidate's resumes on JobAdder: the original(s) they sent and the
// formatted (ConnectOS-branded) version(s). The recruiter can open any of them;
// client attendees only ever see a formatted one.
//
// UNVERIFIED: JobAdder's attachment endpoints (GET /candidates/{id}/attachments
// and .../attachments/{attachmentId}) and their field names. A formatted resume
// is one whose attachment type (or file name) says "formatted" - JobAdder's
// type for it is "FormattedResume". When no resume is found, the attachment
// fields are logged so the matching can be adjusted.

const MAX_RESUME_BYTES = 15 * 1024 * 1024;

export type ResumeVersion = {
  id: string;
  fileName: string;
  formatted: boolean;
  createdAt: string | null;
  // Matched by JobAdder's attachment type (rather than only its file name).
  byType: boolean;
  // A PDF, Word (.docx) or text file - the formats that can be read and shown.
  readable: boolean;
};

export type ResumeFormat = "pdf" | "docx" | "text";
export type ResumeFile = { fileName: string; bytes: Buffer; contentType: string; format: ResumeFormat | null };

type Attachment = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const kindOf = (a: Attachment) => `${str(a.attachmentType)} ${str(a.type)} ${str(a.category)}`.toLowerCase();
const nameOf = (a: Attachment) => str(a.fileName ?? a.name ?? a.filename);
const dateOf = (a: Attachment) => str(a.createdAt ?? a.dateCreated ?? a.updatedAt ?? a.dateUpdated) || null;

const READABLE = /\.(pdf|docx|txt)$/i;
const READABLE_TYPE = /pdf|wordprocessingml|^text\//i;
const typeOf = (a: Attachment) => str(a.contentType ?? a.mimeType ?? a.fileType ?? a.mediaType);
// By file name or the content type JobAdder lists. A file with neither (no
// extension, generic type) is still tried: its format is read from its bytes.
const readableAttachment = (a: Attachment) => READABLE.test(nameOf(a)) || READABLE_TYPE.test(typeOf(a)) || !/\.\w{2,5}$/.test(nameOf(a));

// What a downloaded resume is, from its first bytes, then its content type and
// name: PDFs start "%PDF-"; Word (.docx) files are zip archives ("PK"). The old
// Word format (.doc) isn't supported.
export function resumeFormat(fileName: string, contentType: string, bytes: Buffer): ResumeFormat | null {
  const head = bytes.subarray(0, 5).toString("latin1");
  if (head === "%PDF-") return "pdf";
  if (head.startsWith("PK\x03\x04")) return /\.(xlsx|pptx|zip)$/i.test(fileName) ? null : "docx";
  if (contentType.includes("pdf") || /\.pdf$/i.test(fileName)) return "pdf";
  if (contentType.includes("wordprocessingml") || /\.docx$/i.test(fileName)) return "docx";
  if (contentType.startsWith("text/plain") || /\.txt$/i.test(fileName)) return "text";
  return null;
}

const DEMO_VERSIONS: ResumeVersion[] = [
  { id: "demo-formatted", fileName: "ConnectOS formatted resume.pdf", formatted: true, createdAt: "2026-10-20T02:00:00Z", byType: true, readable: true },
  { id: "demo-original", fileName: "Resume (as sent).pdf", formatted: false, createdAt: "2026-10-12T02:00:00Z", byType: true, readable: true },
];

// Every resume, newest first.
export async function listResumeVersions(candidateId: string): Promise<{ versions: ResumeVersion[]; problem: string | null }> {
  if (demoMode()) return { versions: DEMO_VERSIONS, problem: null };
  if (!/^\d+$/.test(candidateId) || !jobAdderWriteConfigured()) return { versions: [], problem: "JobAdder isn't connected." };
  let list: Attachment[];
  try {
    const res = await jobAdderGet<{ items?: Attachment[] } | Attachment[]>(`/candidates/${candidateId}/attachments`);
    list = Array.isArray(res) ? res : (res.items ?? []);
  } catch (err) {
    console.error("[resume] Attachment list failed", candidateId, err);
    return { versions: [], problem: "Couldn't read the candidate's attachments from JobAdder." };
  }

  const versions = list
    .filter((a) => str(a.attachmentId ?? a.id) && (/resume|cv/.test(kindOf(a)) || /resume|cv/i.test(nameOf(a))))
    .map(
      (a): ResumeVersion => ({
        id: str(a.attachmentId ?? a.id),
        fileName: nameOf(a) || "resume",
        formatted: /formatted/.test(kindOf(a)) || /formatted/i.test(nameOf(a)),
        createdAt: dateOf(a),
        byType: /resume|cv/.test(kindOf(a)),
        readable: readableAttachment(a),
      }),
    )
    .sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0));

  if (versions.length === 0) {
    console.info("[resume] No resume found for candidate", candidateId, "-", list.length, "attachments, fields:", list[0] ? Object.keys(list[0]).join(", ") : "(none)");
    return { versions, problem: list.length ? "No resume among the candidate's JobAdder attachments." : "No resume on JobAdder." };
  }
  return { versions, problem: null };
}

export async function downloadResumeVersion(candidateId: string, version: ResumeVersion): Promise<ResumeFile> {
  const file = await jobAdderGetFile(`/candidates/${candidateId}/attachments/${encodeURIComponent(version.id)}`, MAX_RESUME_BYTES);
  return { fileName: version.fileName, ...file, format: resumeFormat(version.fileName, file.contentType, file.bytes) };
}

// The resume the pre-interview review reads: the newest readable one.
export function versionForReview(versions: ResumeVersion[]): ResumeVersion | null {
  return versions.find((v) => v.byType && v.readable) ?? versions.find((v) => v.readable) ?? versions.find((v) => v.byType) ?? null;
}

// The one client attendees see: the formatted version the recruiter chose, or
// the newest formatted one. Never an original.
export function versionForClient(versions: ResumeVersion[], chosenId: string | null): ResumeVersion | null {
  const formatted = versions.filter((v) => v.formatted);
  return formatted.find((v) => v.id === chosenId) ?? formatted[0] ?? null;
}
