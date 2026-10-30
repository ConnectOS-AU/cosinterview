import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { listAttendees, type Attendee } from "@/lib/attendance";
import { getCandidateReview } from "@/lib/candidate-review";
import { clientResumeId, listGuests } from "@/lib/guests";
import { listResumeVersions } from "@/lib/resumes";
import { getJobDescription } from "@/lib/job-description";
import { mailConfigured } from "@/lib/mail";
import { findInviteById } from "@/lib/repo";
import { requireRecruiter } from "@/lib/staff/auth";
import { listNotes } from "@/lib/staff/repo";
import { STATUS_BADGE } from "@/lib/staff/status";
import { isClientStage, stageLabel, stagePrefix } from "@/lib/stages";
import { getInterviewRecord } from "@/lib/staff/transcripts";
import { BookingActions } from "../../interviews/booking-actions";
import { ROW_BUTTON } from "../../interviews/button-styles";
import { InterviewRecordView } from "./interview-record";
import { InterviewScreen } from "./interview-screen";
import { InterviewAside } from "./interview-aside";
import { GuestsPanel } from "./guests-panel";
import { ResumesPanel } from "./resumes-panel";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function BookingPage({ params }: Props) {
  const { id } = await params;
  const { recruiter } = await requireRecruiter();
  const invite = await findInviteById(id);
  if (!invite || invite.recruiter.id !== recruiter.id) notFound();

  const live = invite.status !== "completed";
  const clientStage = isClientStage(invite.interview.stage);
  const [notes, jobDescription, review, guests, resumes, resumeChoice, attendees] = await Promise.all([
    listNotes(invite.bookingId),
    live ? getJobDescription(invite.interview.jobadderJobId) : null,
    live ? getCandidateReview(invite.bookingId) : null,
    listGuests(invite.bookingId),
    listResumeVersions(invite.jobadderCandidateId),
    clientStage ? clientResumeId(invite.bookingId) : null,
    listAttendees(invite.bookingId),
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
            <span className="font-medium text-neutral-700">{stageLabel(invite.interview.stage)}</span> · {invite.interview.jobTitle ?? "Interview"}
            {invite.interview.clientName && ` · ${invite.interview.clientName}`} · {when}
          </p>
          {(invite.candidateWhatsapp || invite.candidateViber) && (
            <p className="mt-0.5 text-xs text-neutral-500">
              {invite.candidateWhatsapp && <>WhatsApp {invite.candidateWhatsapp}</>}
              {invite.candidateWhatsapp && invite.candidateViber && " · "}
              {invite.candidateViber && <>Viber {invite.candidateViber}</>}
            </p>
          )}
        </div>
        <div className="flex items-start gap-2">
          {invite.status !== "invited" && invite.status !== "cancelled" && (
            <Link
              href={`/r/bookings/${invite.bookingId}/overview`}
              className={ROW_BUTTON}
            >
              Candidate overview
            </Link>
          )}
          <BookingActions bookingId={invite.bookingId} status={invite.status} canEmail={mailConfigured()} />
          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>{badge.label}</span>
        </div>
      </div>

      {attendees.length > 0 && <Attendance attendees={attendees} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {invite.status !== "cancelled" && (
          <GuestsPanel
            bookingId={invite.bookingId}
            initialGuests={guests}
            canEmail={mailConfigured()}
            open={invite.status !== "completed" && invite.status !== "no_show"}
            clientStage={clientStage}
          />
        )}
        <ResumesPanel
          bookingId={invite.bookingId}
          versions={resumes.versions}
          problem={resumes.problem}
          clientChoice={resumeChoice}
          forClients={invite.status !== "cancelled" && invite.status !== "completed" && invite.status !== "no_show"}
        />
      </div>

      {invite.status === "completed" ? (
        <InterviewRecordView bookingId={invite.bookingId} record={await getInterviewRecord(invite.bookingId)} notes={notes} />
      ) : (
        <InterviewScreen
          bookingId={invite.bookingId}
          candidateName={invite.candidateName}
          canJoin={invite.status === "booked" || invite.status === "in_progress"}
          initialNotes={notes}
          notePrefix={stagePrefix(invite.interview.stage, invite.slotStart)}
          slot={invite.slotStart && invite.slotEnd ? { start: invite.slotStart, end: invite.slotEnd, zone: recruiter.timezone } : null}
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

const KIND_STYLE: Record<Attendee["kind"], string> = {
  recruiter: "bg-neutral-100 text-neutral-700",
  candidate: "bg-sky-50 text-sky-800",
  client: "bg-amber-50 text-amber-800",
  other: "bg-violet-50 text-violet-800",
};

// Who has joined the call (also written to JobAdder when the interview ends).
function Attendance({ attendees }: { attendees: Attendee[] }) {
  return (
    <section className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Attended</span>
      {attendees.map((a) => (
        <span key={`${a.kind}:${a.name}`} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${KIND_STYLE[a.kind]}`}>
          {a.name} <span className="font-normal opacity-70">· {a.kind}</span>
        </span>
      ))}
    </section>
  );
}
