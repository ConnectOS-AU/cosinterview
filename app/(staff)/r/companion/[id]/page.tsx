import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCandidateReview } from "@/lib/candidate-review";
import { getJobDescription } from "@/lib/job-description";
import { findInviteById } from "@/lib/repo";
import { getStaff } from "@/lib/staff/auth";
import { CompanionView } from "./companion-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Interview - second screen" };

type Props = { params: Promise<{ id: string }> };

// The second-screen window opened from the interview screen: the job
// description and the questions side by side, without the site's menu.
export default async function CompanionPage({ params }: Props) {
  const { id } = await params;
  const staff = await getStaff();
  if (!staff) redirect("/r/login");
  if (!staff.recruiter) notFound();
  const invite = await findInviteById(id);
  if (!invite || invite.recruiter.id !== staff.recruiter.id) notFound();

  const [jobHtml, review] = await Promise.all([getJobDescription(invite.interview.jobadderJobId), getCandidateReview(invite.bookingId)]);

  return (
    <CompanionView
      bookingId={invite.bookingId}
      candidateName={invite.candidateName}
      jobTitle={invite.interview.jobTitle}
      jobHtml={jobHtml}
      questions={review.review?.questions ?? null}
      reviewStatus={review.status}
    />
  );
}
