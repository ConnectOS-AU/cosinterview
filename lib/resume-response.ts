import "server-only";
import mammoth from "mammoth";
import sanitizeHtml from "sanitize-html";
import type { ResumeFile } from "./resumes";

// Shows a resume in the browser: PDFs as they are; Word documents and text
// files become a plain page. Used by the recruiter's and the client lobby's
// resume links.

const PAGE_STYLE =
  "body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2933;max-width:760px;margin:0 auto;padding:24px}" +
  "h1,h2,h3{line-height:1.25}img{max-width:100%}table{border-collapse:collapse}td,th{padding:4px 8px;vertical-align:top}";

const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function resumePage(title: string, body: string, status = 200): Response {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>${PAGE_STYLE}</style></head><body>${body}</body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      // Nothing in a converted resume may run or reach out.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; sandbox",
    },
  });
}

export const resumeNotice = (text: string, status = 200) => resumePage("Resume", `<p style="color:#52606d">${escape(text)}</p>`, status);

// A stand-in for the local demo, which has no JobAdder.
export function demoResume(candidateName: string, fileName: string): Response {
  return resumePage(
    fileName,
    `<p style="color:#52606d">Demo: ${escape(fileName)}</p><h1>${escape(candidateName)}</h1>` +
      "<h2>Experience</h2><p><strong>Customer Support Lead</strong>, Example BPO, 2021 - present</p><ul><li>Led a team of 8 handling email and chat support</li><li>Kept first-response time under 2 hours</li></ul>" +
      "<h2>Education</h2><p>BS Business Administration, University of the Philippines</p>",
  );
}

export async function resumeResponse(file: ResumeFile): Promise<Response> {
  const safeName = file.fileName.replace(/[^\w. -]/g, "_");
  if (file.format === "pdf") {
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "frame-ancestors 'self'",
      },
    });
  }
  try {
    if (file.format === "docx") {
      const { value } = await mammoth.convertToHtml({ buffer: file.bytes });
      const clean = sanitizeHtml(value, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2"]),
        allowedSchemes: ["data"],
        allowedAttributes: { img: ["src", "alt"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] },
      });
      return resumePage(safeName, clean);
    }
    if (file.format === "text") {
      return resumePage(safeName, `<pre style="white-space:pre-wrap;font-family:inherit">${escape(file.bytes.toString("utf8"))}</pre>`);
    }
  } catch (err) {
    console.error("[resume] Conversion failed", file.fileName, err);
  }
  return resumeNotice(`${file.fileName} can't be shown in the browser - resumes need to be PDF or Word (.docx).`);
}
