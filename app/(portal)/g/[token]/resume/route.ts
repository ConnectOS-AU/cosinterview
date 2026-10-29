import { demoMode } from "@/lib/demo";
import { clientResumeId, findGuestByToken } from "@/lib/guests";
import { demoResume, resumeNotice, resumeResponse } from "@/lib/resume-response";
import { downloadResumeVersion, listResumeVersions, versionForClient } from "@/lib/resumes";

export const dynamic = "force-dynamic";

// The candidate's resume for a client attendee: only ever a formatted version
// (the one the recruiter chose, or the newest), never the original they sent.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await findGuestByToken(token);
  if (!found || found.invite.status === "cancelled") return resumeNotice("This link isn't valid.", 404);
  const { invite } = found;

  const [{ versions }, chosen] = await Promise.all([listResumeVersions(invite.jobadderCandidateId), clientResumeId(invite.bookingId)]);
  const version = versionForClient(versions, chosen);
  if (!version) return resumeNotice("The candidate's resume isn't ready yet. Your ConnectOS recruiter will add it before the interview.");
  if (demoMode()) return demoResume(invite.candidateName, version.fileName);
  try {
    return await resumeResponse(await downloadResumeVersion(invite.jobadderCandidateId, version));
  } catch (err) {
    console.error("[guest resume]", invite.bookingId, err);
    return resumeNotice("The resume couldn't be loaded just now. Please refresh to try again.");
  }
}
