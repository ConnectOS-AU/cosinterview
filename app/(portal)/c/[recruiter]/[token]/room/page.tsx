import Link from "next/link";
import { joinWindow, loadInvite, publicRecruiter } from "@/lib/invite";
import { getLobbyContent } from "@/lib/lobby";
import { Notice, PortalShell } from "../../../portal-shell";
import { InterviewRoom } from "./interview-room";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ recruiter: string; token: string }> };

export default async function RoomPage({ params }: Props) {
  const { recruiter: slug, token } = await params;
  const invite = await loadInvite(slug, token);
  if (!invite) {
    return (
      <PortalShell>
        <Notice title="This link isn't valid">
          <p>Please use the link from your invitation email, or contact your ConnectOS recruiter.</p>
        </Notice>
      </PortalShell>
    );
  }

  const recruiter = publicRecruiter(invite);
  const window = joinWindow(invite);
  if ((invite.status !== "booked" && invite.status !== "in_progress") || !window || !invite.slotStart) {
    return (
      <PortalShell recruiter={recruiter}>
        <Notice title="No interview booked yet">
          <p>
            <Link href={`/c/${slug}/${token}`} className="text-brand-teal underline">
              Choose a time for your interview
            </Link>{" "}
            first, then come back here when it&apos;s time.
          </p>
        </Notice>
      </PortalShell>
    );
  }

  const lobby = await getLobbyContent();
  return (
    <InterviewRoom
      recruiterSlug={slug}
      token={token}
      recruiter={recruiter}
      candidateFirstName={invite.candidateName.split(" ")[0]!}
      startsAt={invite.slotStart}
      opensAt={window.opens.toISO()!}
      zone={invite.candidateTimezone ?? invite.recruiter.timezone}
      lobby={lobby}
    />
  );
}
