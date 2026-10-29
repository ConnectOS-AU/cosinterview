import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { getCandidateReview } from "@/lib/candidate-review";
import { getJobDescription } from "@/lib/job-description";
import { mailConfigured } from "@/lib/mail";
import { findInviteById } from "@/lib/repo";
import { requireRecruiter } from "@/lib/staff/auth";
import { listNotes } from "@/lib/staff/repo";
import { STATUS_BADGE } from "@/lib/staff/status";
import { getInterviewRecord } from "@/lib/staff/transcripts";
import { BookingActions } from "../../interviews/booking-actions";
import { InterviewRecordView } from "./interview-record";
import { InterviewScreen } from "./interview-screen";
import { InterviewAside } from "./interview-aside";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function BookingPage({ params }: Props) {
  const { id } = await params;
  const { recruiter } = await requireRecruiter();
  const invite = await findInviteById(id);
  if (!invite || invite.recruiter.id !== recruiter.id) notFound();

  const live = invite.status !== "completed";
  const [notes, jobDescription, review] = await Promise.all([
    listNotes(invite.bookingId),
    live ? getJobDescription(invite.interview.jobadderJobId) : null,
    live ? getCandidateReview(invite.bookingId) : null,
  ]);
  const zone = recruiter.timezone;
  const badge = STATUS_BADGE[invite.status];
  const when =
    invite.slotStart && invite.slotEnd
      ? `${DateTime.fromISO(invite.slotStart, { zone }).toFormat("cccc d LLLL, h:mm")}–${DateTime.fromISO(invite.slotEnd, { zone }).toFormat("h:mm a")}`
      : "Not booked yet";

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/r" className="text-xs font-medium text-neutral-500 hover:text-neutral-800">
            ← Interviews
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-900">{invite.candidateName}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            {invite.interview.jobTitle ?? "Interview"}
            {invite.interview.clientName && ` · ${invite.interview.clientName}`} · {when}
          </p>
        </div>
        <div className="flex items-start gap-4">
          {invite.status !== "invited" && invite.status !== "cancelled" && (
            <Link
              href={`/r/bookings/${invite.bookingId}/overview`}
              className="pt-1.5 text-xs font-medium text-neutral-700 underline hover:text-neutral-950"
            >
              Candidate overview
            </Link>
          )}
          <BookingActions bookingId={invite.bookingId} status={invite.status} canEmail={mailConfigured()} />
          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>{badge.label}</span>
        </div>
      </div>

      {invite.status === "completed" ? (
        <InterviewRecordView bookingId={invite.bookingId} record={await getInterviewRecord(invite.bookingId)} notes={notes} />
      ) : (
        <InterviewScreen
          bookingId={invite.bookingId}
          candidateName={invite.candidateName}
          canJoin={invite.status === "booked" || invite.status === "in_progress"}
          initialNotes={notes}
          aside={
            <InterviewAside
              bookingId={invite.bookingId}
              jobTitle={invite.interview.jobTitle}
              jobHtml={jobDescription}
              questions={review?.review?.questions ?? null}
              reviewStatus={review?.status ?? "none"}
            />
          }
        />
      )}
    </main>
  );
}
