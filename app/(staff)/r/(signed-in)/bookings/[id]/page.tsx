import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { findInviteById } from "@/lib/repo";
import { requireRecruiter } from "@/lib/staff/auth";
import { listNotes } from "@/lib/staff/repo";
import { STATUS_BADGE } from "@/lib/staff/status";
import { InterviewScreen } from "./interview-screen";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function BookingPage({ params }: Props) {
  const { id } = await params;
  const { recruiter } = await requireRecruiter();
  const invite = await findInviteById(id);
  if (!invite || invite.recruiter.id !== recruiter.id) notFound();

  const notes = await listNotes(invite.bookingId);
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
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>{badge.label}</span>
      </div>

      <InterviewScreen
        bookingId={invite.bookingId}
        candidateName={invite.candidateName}
        canJoin={invite.status === "booked" || invite.status === "in_progress"}
        initialNotes={notes}
      />
    </main>
  );
}
