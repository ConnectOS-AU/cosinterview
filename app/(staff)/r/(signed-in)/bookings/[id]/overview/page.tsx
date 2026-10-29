import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { getCandidateReview, type ReviewState } from "@/lib/candidate-review";
import { findInviteById } from "@/lib/repo";
import { requireRecruiter } from "@/lib/staff/auth";
import { SUITABILITY_LABEL, TOPIC_LABEL } from "@/lib/review-labels";
import type { CandidateReview } from "@/lib/worker/review";
import { ReviewControls } from "./review-controls";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const BAND: Record<CandidateReview["suitability"], string> = {
  strong: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  good: "bg-sky-50 text-sky-800 ring-sky-200",
  possible: "bg-amber-50 text-amber-800 ring-amber-200",
  unlikely: "bg-red-50 text-red-800 ring-red-200",
};


export default async function CandidateOverviewPage({ params }: Props) {
  const { id } = await params;
  const { recruiter } = await requireRecruiter();
  const invite = await findInviteById(id);
  if (!invite || invite.recruiter.id !== recruiter.id) notFound();
  const state = await getCandidateReview(invite.bookingId);
  const zone = recruiter.timezone;
  const when = invite.slotStart ? DateTime.fromISO(invite.slotStart, { zone }).toFormat("cccc d LLLL, h:mm a") : "Not booked yet";
  const booked = invite.status !== "invited" && invite.status !== "cancelled";

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-6 py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/r" className="text-xs font-medium text-neutral-500 hover:text-neutral-800">
            ← Interviews
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-neutral-900">Candidate overview: {invite.candidateName}</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            {invite.interview.jobTitle ?? "Interview"}
            {invite.interview.clientName && ` · ${invite.interview.clientName}`} · {when}
          </p>
        </div>
        {booked && (
          <Link
            href={`/r/bookings/${invite.bookingId}`}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Open interview
          </Link>
        )}
      </div>

      {!booked ? (
        <Notice>The overview is written once the candidate books a time.</Notice>
      ) : state.status === "done" && state.review ? (
        <Review state={state} review={state.review} bookingId={invite.bookingId} zone={zone} />
      ) : state.status === "pending" || state.status === "running" ? (
        <Notice>
          <p>The overview is being written from the resume, JobAdder notes and job description. This page updates by itself.</p>
          <ReviewControls bookingId={invite.bookingId} label="Write it again" waiting />
        </Notice>
      ) : state.status === "failed" ? (
        <Notice>
          <p>The overview couldn&apos;t be written{state.attempts ? ` (${state.attempts} attempt${state.attempts === 1 ? "" : "s"})` : ""}.</p>
          {state.error && <p className="text-xs text-neutral-500">{state.error}</p>}
          <ReviewControls bookingId={invite.bookingId} label="Try again" waiting={false} />
        </Notice>
      ) : (
        <Notice>
          <p>No overview yet. It&apos;s written automatically after booking, or you can write it now.</p>
          <ReviewControls bookingId={invite.bookingId} label="Write the overview now" waiting={false} />
        </Notice>
      )}
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 rounded-lg border border-dashed border-neutral-300 bg-white px-5 py-6 text-sm text-neutral-600">{children}</div>;
}

function Card({ title, tone, children }: { title: string; tone?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <h2 className={`mb-3 text-sm font-semibold ${tone ?? "text-neutral-900"}`}>{title}</h2>
      {children}
    </section>
  );
}

function Review({ state, review, bookingId, zone }: { state: ReviewState; review: CandidateReview; bookingId: string; zone: string }) {
  const sources = state.sources;
  return (
    <>
      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Opinion before the interview</p>
        <div className="mt-3 flex flex-wrap items-center gap-6">
          <div>
            <p className="text-5xl font-semibold tabular-nums text-neutral-900">{review.likelihoodPercent}%</p>
            <p className="mt-1 text-xs text-neutral-500">likelihood of being the successful candidate</p>
          </div>
          <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ring-1 ${BAND[review.suitability]}`}>
            {SUITABILITY_LABEL[review.suitability]}
          </span>
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-neutral-800">{review.opinion}</p>
        <p className="mt-3 text-xs text-neutral-500">
          Written by AI from the documents only - a starting point for the interview, not a decision.
        </p>
      </section>

      <Card title="Summary">
        <p className="text-sm leading-relaxed text-neutral-700">{review.summary}</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Positives" tone="text-emerald-800">
          <List items={review.positives} empty="None noted." />
        </Card>
        <Card title="Gaps" tone="text-amber-800">
          <Points items={review.gaps} empty="No gaps against the job description." />
        </Card>
        <Card title="Discrepancies" tone="text-red-800">
          <Points items={review.discrepancies} empty="Nothing that doesn't add up." />
        </Card>
      </div>

      <Card title="Questions to ask">
        <p className="-mt-2 mb-3 text-xs text-neutral-500">Also shown beside the video on the interview screen, to read to the candidate.</p>
        <ol className="space-y-3">
          {review.questions.map((q, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="w-5 flex-shrink-0 text-right font-semibold tabular-nums text-neutral-400">{i + 1}.</span>
              <div>
                <p className="text-neutral-900">{q.question}</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  <span className="mr-1.5 rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">{TOPIC_LABEL[q.topic]}</span>
                  {q.purpose}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="What it was based on">
        <ul className="space-y-1.5 text-sm text-neutral-700">
          <li>Resume: {sources?.resumeFile ?? <span className="text-amber-700">{sources?.resumeProblem ?? "not found"}</span>}</li>
          <li>JobAdder notes: {sources?.jobadderNotes ?? 0}</li>
          <li>Job description: {sources?.jobDescription ? "from JobAdder" : <span className="text-amber-700">none in JobAdder - judged on the job title</span>}</li>
          <li>
            LinkedIn:{" "}
            {sources?.linkedinUrl ? (
              <>
                <a href={sources.linkedinUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-neutral-900 underline">
                  open profile ↗
                </a>{" "}
                <span className="text-xs text-neutral-500">- not read automatically (LinkedIn doesn&apos;t allow it). Worth a look before the interview.</span>
              </>
            ) : (
              "none given"
            )}
          </li>
        </ul>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4">
          <p className="text-xs text-neutral-500">
            {state.updatedAt && `Written ${DateTime.fromISO(state.updatedAt, { zone }).toFormat("d LLL, h:mm a")}`}
            {state.jobAdderNotedAt ? " · added to JobAdder notes" : " · not added to JobAdder"}
          </p>
          <ReviewControls bookingId={bookingId} label="Regenerate" waiting={false} />
        </div>
      </Card>
    </>
  );
}

function List({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-neutral-400">{empty}</p>;
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm text-neutral-700">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ul>
  );
}

function Points({ items, empty }: { items: { point: string; detail: string }[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-neutral-400">{empty}</p>;
  return (
    <ul className="space-y-2.5 text-sm">
      {items.map((p, i) => (
        <li key={i}>
          <p className="font-medium text-neutral-900">{p.point}</p>
          <p className="text-neutral-600">{p.detail}</p>
        </li>
      ))}
    </ul>
  );
}
