import { demoMode } from "@/lib/demo";
import { findInviteById } from "@/lib/repo";
import { demoResume, resumeNotice, resumeResponse } from "@/lib/resume-response";
import { downloadResumeVersion, listResumeVersions } from "@/lib/resumes";
import { requireRecruiter } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

// Any version of the candidate's resume (original or formatted), for the
// recruiter running this interview.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; version: string }> }) {
  const { id, version: versionId } = await params;
  const { recruiter } = await requireRecruiter();
  const invite = await findInviteById(id);
  if (!invite || invite.recruiter.id !== recruiter.id) return resumeNotice("Interview not found.", 404);

  const { versions } = await listResumeVersions(invite.jobadderCandidateId);
  const version = versions.find((v) => v.id === versionId);
  if (!version) return resumeNotice("That resume isn't on the candidate's JobAdder record any more.", 404);
  if (demoMode()) return demoResume(invite.candidateName, version.fileName);
  try {
    return await resumeResponse(await downloadResumeVersion(invite.jobadderCandidateId, version));
  } catch (err) {
    console.error("[recruiter resume]", id, err);
    return resumeNotice("The resume couldn't be loaded from JobAdder just now. Please try again.");
  }
}
