import type { Metadata } from "next";
import { findGuestByToken, guestDisplayName } from "@/lib/guests";
import { joinWindow, publicRecruiter } from "@/lib/invite";
import { getJobDescription } from "@/lib/job-description";
import { stageLabel, stagePrefix } from "@/lib/stages";
import { Notice, PortalShell } from "../../c/portal-shell";
import { loadGuestNotes } from "./actions";
import { GuestRoom } from "./guest-room";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Interview · ConnectOS Interviews" };

type Props = { params: Promise<{ token: string }> };

// The attendee lobby: the page for a client attendee (or another invited
// person) on an interview. They read the candidate's formatted resume and the job description, keep notes, and wait
// here until the recruiter brings them into the video call.
export default async function GuestLobbyPage({ params }: Props) {
  const { token } = await params;
  const found = await findGuestByToken(token);
  if (!found) {
    return (
      <PortalShell>
        <Notice title="This link isn't valid">
          <p>Please use the link from your invitation email, or contact your ConnectOS recruiter for a new one.</p>
        </Notice>
      </PortalShell>
    );
  }
  const { guest, invite } = found;
  const recruiter = publicRecruiter(invite);
  if (invite.status === "cancelled") {
    return (
      <PortalShell recruiter={recruiter}>
        <Notice title="This interview was cancelled">
          <p>{recruiter.firstName} will be in touch if it&apos;s rearranged.</p>
        </Notice>
      </PortalShell>
    );
  }

  const [jobHtml, notes] = await Promise.all([getJobDescription(invite.interview.jobadderJobId), loadGuestNotes(token)]);
  const window = joinWindow(invite);
  return (
    <GuestRoom
      token={token}
      guestName={guestDisplayName(guest)}
      recruiter={recruiter}
      candidateName={invite.candidateName}
      jobTitle={invite.interview.jobTitle}
      stage={stageLabel(invite.interview.stage)}
      notePrefix={stagePrefix(invite.interview.stage, invite.slotStart)}
      startsAt={invite.slotStart}
      endsAt={invite.slotEnd}
      opensAt={window?.opens.toISO() ?? null}
      finished={invite.status === "completed" || invite.status === "no_show"}
      jobHtml={jobHtml}
      initialNotes={notes}
    />
  );
}
