import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getJobDescription } from "@/lib/job-description";
import { findInviteById } from "@/lib/repo";
import { getStaff } from "@/lib/staff/auth";
import { JobDescriptionPane } from "../../../(signed-in)/bookings/[id]/job-description-pane";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Job description" };

type Props = { params: Promise<{ id: string }> };

// The job description, opened in its own tab from the interview screen so the
// video there keeps the space. No site menu, with the usual zoom.
export default async function JobDescriptionPage({ params }: Props) {
  const { id } = await params;
  const staff = await getStaff();
  if (!staff) redirect("/r/login");
  if (!staff.recruiter) notFound();
  const invite = await findInviteById(id);
  if (!invite || invite.recruiter.id !== staff.recruiter.id) notFound();

  const html = await getJobDescription(invite.interview.jobadderJobId);
  return (
    <main className="min-h-screen bg-neutral-50 p-4">
      <JobDescriptionPane jobTitle={invite.interview.jobTitle} html={html} sizeClass="h-[calc(100dvh-2rem)]" />
    </main>
  );
}
