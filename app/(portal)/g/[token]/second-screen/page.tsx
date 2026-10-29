import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findGuestByToken } from "@/lib/guests";
import { getJobDescription } from "@/lib/job-description";
import { SecondScreenView } from "./second-screen-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Interview - second screen" };

type Props = { params: Promise<{ token: string }> };

// The client lobby's second-screen window: the resume and the job description
// side by side.
export default async function GuestSecondScreen({ params }: Props) {
  const { token } = await params;
  const found = await findGuestByToken(token);
  if (!found || found.invite.status === "cancelled") notFound();
  const { invite } = found;
  return (
    <SecondScreenView
      token={token}
      candidateName={invite.candidateName}
      jobTitle={invite.interview.jobTitle}
      jobHtml={await getJobDescription(invite.interview.jobadderJobId)}
    />
  );
}
