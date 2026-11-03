import { linkedinPdfContent } from "@/lib/linkedin-pdf";
import { findInviteById } from "@/lib/repo";
import { resumeNotice } from "@/lib/resume-response";
import { requireRecruiter } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

// The LinkedIn profile PDF uploaded for this interview, for its recruiter.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { recruiter } = await requireRecruiter();
  const invite = await findInviteById(id);
  if (!invite || invite.recruiter.id !== recruiter.id) return resumeNotice("Interview not found.", 404);

  const pdf = await linkedinPdfContent(invite.bookingId);
  if (!pdf) return resumeNotice("No LinkedIn PDF has been uploaded for this interview.", 404);
  return new Response(new Uint8Array(Buffer.from(pdf.base64, "base64")), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${pdf.fileName.replace(/[^\w. -]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  });
}
