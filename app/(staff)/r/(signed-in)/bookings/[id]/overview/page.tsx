import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { getDebrief, likelihoodTimeline, NEXT_STEP_LABEL, OUTCOME_LABEL, type DebriefState, type TimelinePoint } from "@/lib/candidate-debrief";
import { getLinkedinCheck, LINKEDIN_OUTCOME_LABEL, type LinkedinCheck } from "@/lib/linkedin-check";
import { getCandidateReview, type ReviewState } from "@/lib/candidate-review";
import { interviewHistory } from "@/lib/interview-history";
import { arrivalLabel, arrivalTrend, candidateArrivals, type Arrival, type ArrivalOutcome } from "@/lib/punctuality";
import { findInviteById } from "@/lib/repo";
import { requireRecruiter } from "@/lib/staff/auth";
import { AI_RESUME_LABEL, SUITABILITY_LABEL, TOPIC_LABEL } from "@/lib/review-labels";
import { stageLabel } from "@/lib/stages";
import type { CandidateDebrief } from "@/lib/worker/debrief";
import type { AiResumeCheck, CandidateReview } from "@/lib/worker/review";
import { InterviewHistory } from "./interview-history";
import { ReviewControls } from "./review-controls";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

const BAND: Record<CandidateReview["suitability"], string> = {
  strong: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  good: "bg-sky-50 text-sky-800 ring-sky-200",
  possible: "bg-amber-50 text-amber-800 ring-amber-200",
  unlikely: "bg-red-50 text-red-800 ring-red-200",
  insufficient: "bg-neutral-100 text-neutral-700 ring-neutral-300",
};

export default async function CandidateOverviewPage({ params }: Props) {
  const { id } = await params;
  const { recruiter } = await requireRecruiter();
  const invite = await findInviteById(id);
  if (!invite || invite.recruiter.id !== recruiter.id) notFound();
  const [state, after, timeline, history, linkedinCheck, arrivals] = await Promise.all([
    getCandidateReview(invite.bookingId),
    getDebrief(invite.bookingId),
    likelihoodTimeline(invite),
    interviewHistory(invite),
    getLinkedinCheck(invite.bookingId).catch(() => null),
    candidateArrivals(invite.jobadderCandidateId).catch(() => []),
  ]);
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
            {stageLabel(invite.interview.stage)} · {invite.interview.jobTitle ?? "Interview"}
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

      {timeline.length > 1 && <Timeline points={timeline} current={invite.bookingId} />}

      <InterviewHistory rounds={history} current={invite.bookingId} zone={zone} />

      {arrivals.length > 0 && <Punctuality arrivals={arrivals} current={invite.bookingId} zone={zone} />}

      {invite.status === "completed" && (
        <AfterInterview state={after} bookingId={invite.bookingId} before={state.review?.likelihoodPercent ?? null} zone={zone} />
      )}

      {invite.status === "completed" && state.status === "done" && (
        <h2 className="pt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Before the interview</h2>
      )}

      {invite.status === "cancelled" && state.status === "none" ? (
        <Notice>This interview was cancelled before an overview was written.</Notice>
      ) : state.status === "done" && state.review ? (
        <Review state={state} review={state.review} bookingId={invite.bookingId} zone={zone} linkedinCheck={linkedinCheck} />
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
          <p>No overview yet. It&apos;s written automatically after the invite, or you can write it now.</p>
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

function Review({
  state,
  review,
  bookingId,
  zone,
  linkedinCheck,
}: {
  state: ReviewState;
  review: CandidateReview;
  bookingId: string;
  zone: string;
  linkedinCheck: LinkedinCheck | null;
}) {
  const sources = state.sources;
  return (
    <>
      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Opinion before the interview</p>
        <div className="mt-3 flex flex-wrap items-center gap-6">
          {review.likelihoodPercent === null ? (
            <div>
              <p className="text-3xl font-semibold text-neutral-400">No opinion yet</p>
              <p className="mt-1 text-xs text-neutral-500">nothing to judge the candidate on - no resume or notes</p>
            </div>
          ) : (
            <div>
              <p className="text-5xl font-semibold tabular-nums text-neutral-900">{review.likelihoodPercent}%</p>
              <p className="mt-1 text-xs text-neutral-500">likelihood of being the successful candidate</p>
            </div>
          )}
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

      {review.aiResume && <AiResume check={review.aiResume} />}

      {review.linkedinComparison && (
        <Card title="LinkedIn profile compared with the resume">
          <p className="max-w-3xl text-sm leading-relaxed text-neutral-700">{review.linkedinComparison.summary}</p>
          <div className="mt-4 grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold text-emerald-800">Matches</h3>
              <List items={review.linkedinComparison.matches} empty="Nothing matched." />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold text-red-800">Differences</h3>
              <Points items={review.linkedinComparison.differences} empty="No differences found." />
            </div>
          </div>
        </Card>
      )}

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
          {Boolean(sources?.earlierInterviews) && <li>Earlier interviews: {sources?.earlierInterviews}, with everyone&apos;s comments and transcripts</li>}
          <li>Job description: {sources?.jobDescription ? "from JobAdder" : <span className="text-amber-700">none in JobAdder - judged on the job title</span>}</li>
          <li>
            LinkedIn PDF:{" "}
            {sources?.linkedinPdfFile ? (
              <a href={`/r/bookings/${bookingId}/linkedin-pdf`} target="_blank" rel="noopener" className="font-medium text-neutral-900 underline">
                {sources.linkedinPdfFile}
              </a>
            ) : (
              "none uploaded"
            )}
          </li>
          <li>
            LinkedIn:{" "}
            {sources?.linkedinUrl ? (
              <>
                <a href={sources.linkedinUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-neutral-900 underline">
                  open profile ↗
                </a>{" "}
                {linkedinCheck ? (
                  <span className={`text-xs ${linkedinCheck.outcome === "matches" ? "text-emerald-700" : "text-amber-700"}`}>
                    - checked by {linkedinCheck.checkedBy}: {LINKEDIN_OUTCOME_LABEL[linkedinCheck.outcome]}
                    {linkedinCheck.note && ` (${linkedinCheck.note})`}
                  </span>
                ) : sources.linkedinPdfFile ? (
                  <span className="text-xs text-neutral-500">- compared from the uploaded PDF.</span>
                ) : (
                  <span className="text-xs text-amber-700">- not read automatically (LinkedIn doesn&apos;t allow it). Upload the profile PDF on the interview screen to compare it with the resume.</span>
                )}
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

const AI_RESUME_STYLE: Record<AiResumeCheck["verdict"], string> = {
  likely_ai: "bg-amber-50 text-amber-800 ring-amber-200",
  possibly_ai: "bg-amber-50 text-amber-800 ring-amber-200",
  likely_human: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  cannot_tell: "bg-neutral-100 text-neutral-700 ring-neutral-300",
};

function AiResume({ check }: { check: AiResumeCheck }) {
  return (
    <Card title="Was the resume written with AI?">
      <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ring-1 ${AI_RESUME_STYLE[check.verdict]}`}>{AI_RESUME_LABEL[check.verdict]}</span>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-700">{check.summary}</p>
      {check.signals.length > 0 && (
        <div className="mt-3 max-w-3xl">
          <List items={check.signals} empty="" />
        </div>
      )}
      <p className="mt-3 text-xs text-neutral-500">An AI opinion from the writing, not proof. It doesn&apos;t change the likelihood: test the claims in the interview.</p>
    </Card>
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

// --- After the interview ----------------------------------------------------------

const OUTCOME_STYLE: Record<CandidateDebrief["answers"][number]["outcome"], string> = {
  resolved: "bg-emerald-50 text-emerald-800",
  partly: "bg-amber-50 text-amber-800",
  concern: "bg-red-50 text-red-800",
  not_asked: "bg-neutral-100 text-neutral-600",
};

const NEXT_STEP_STYLE: Record<CandidateDebrief["nextStep"], string> = {
  progress: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  progress_with_checks: "bg-sky-50 text-sky-800 ring-sky-200",
  hold: "bg-amber-50 text-amber-800 ring-amber-200",
  do_not_progress: "bg-red-50 text-red-800 ring-red-200",
};

function AfterInterview({ state, bookingId, before, zone }: { state: DebriefState; bookingId: string; before: number | null; zone: string }) {
  if (state.status !== "done" || !state.debrief) {
    return (
      <Notice>
        {state.status === "running" ? (
          <p>The overview after the interview is being written from the transcript.</p>
        ) : state.status === "failed" ? (
          <>
            <p>The overview after the interview couldn&apos;t be written.</p>
            {state.error && <p className="text-xs text-neutral-500">{state.error}</p>}
          </>
        ) : (
          <p>The overview after the interview is written once the transcript is ready (usually within 15 minutes of the call ending), or from the comments if there&apos;s no recording.</p>
        )}
        <ReviewControls bookingId={bookingId} label={state.status === "failed" ? "Try again" : "Write it now"} waiting={state.status === "running"} after />
      </Notice>
    );
  }
  const d = state.debrief;
  const moved = before !== null && d.likelihoodPercent !== null ? d.likelihoodPercent - before : null;
  return (
    <>
      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">After the interview</p>
        <div className="mt-3 flex flex-wrap items-center gap-6">
          <div>
            <p className="text-5xl font-semibold tabular-nums text-neutral-900">{d.likelihoodPercent === null ? "?" : `${d.likelihoodPercent}%`}</p>
            <p className="mt-1 text-xs text-neutral-500">
              likelihood now
              {moved !== null && (
                <span className={`ml-1.5 font-semibold ${moved > 0 ? "text-emerald-700" : moved < 0 ? "text-red-700" : "text-neutral-500"}`}>
                  {moved > 0 ? "▲" : moved < 0 ? "▼" : "="} {Math.abs(moved)} from {before}%
                </span>
              )}
            </p>
          </div>
          <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ring-1 ${BAND[d.suitability]}`}>{SUITABILITY_LABEL[d.suitability]}</span>
          <span className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ring-1 ${NEXT_STEP_STYLE[d.nextStep]}`}>{NEXT_STEP_LABEL[d.nextStep]}</span>
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-neutral-800">{d.opinion}</p>
        <p className="mt-2 max-w-3xl text-sm text-neutral-600">
          <span className="font-medium text-neutral-800">Next step:</span> {d.nextStepReason}
        </p>
      </section>

      <Card title="Recommendations" tone="text-sky-800">
        {d.recommendations.length === 0 ? (
          <p className="text-sm text-neutral-400">None.</p>
        ) : (
          <ul className="space-y-2.5 text-sm">
            {d.recommendations.map((r, i) => (
              <li key={i}>
                <p className="font-medium text-neutral-900">{r.recommendation}</p>
                <p className="text-neutral-600">{r.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Addressed in the interview" tone="text-emerald-800">
          <Points items={d.addressed} empty="Nothing from before the interview was settled." />
        </Card>
        <Card title="Concerns" tone="text-red-800">
          {d.concerns.length === 0 ? (
            <p className="text-sm text-neutral-400">No remaining concerns.</p>
          ) : (
            <ul className="space-y-2.5 text-sm">
              {d.concerns.map((c, i) => (
                <li key={i}>
                  <p className="font-medium text-neutral-900">
                    {c.point}
                    {c.isNew && <span className="ml-2 rounded bg-red-50 px-1.5 py-px text-xs font-medium text-red-700">New</span>}
                  </p>
                  <p className="text-neutral-600">{c.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {d.answers.length > 0 && (
        <Card title="Answers to the suggested questions">
          <p className="-mt-2 mb-3 text-xs text-neutral-500">From the transcript - times are positions in the recording.</p>
          <ol className="space-y-3">
            {d.answers.map((a, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="w-5 flex-shrink-0 text-right font-semibold tabular-nums text-neutral-400">{i + 1}.</span>
                <div>
                  <p className="text-neutral-900">{a.question}</p>
                  <p className="mt-1 text-neutral-700">
                    <span className={`mr-1.5 rounded px-1.5 py-0.5 text-xs font-medium ${OUTCOME_STYLE[a.outcome]}`}>{OUTCOME_LABEL[a.outcome]}</span>
                    {a.answer}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-5 py-3">
        <p className="text-xs text-neutral-500">
          Written by AI from the transcript, everyone&apos;s comments and any earlier interviews - advisory only.
          {state.updatedAt && ` Written ${DateTime.fromISO(state.updatedAt, { zone }).toFormat("d LLL, h:mm a")}`}
          {state.jobAdderNotedAt ? " · added to JobAdder notes" : " · not added to JobAdder"}
        </p>
        <ReviewControls bookingId={bookingId} label="Regenerate" waiting={false} after />
      </div>
    </>
  );
}

// The likelihood through every interview round for this candidate and job:
// before (light) and after (dark) each interview.
const ARRIVAL_STYLE: Record<ArrivalOutcome, string> = {
  early: "bg-emerald-50 text-emerald-800",
  on_time: "bg-emerald-50 text-emerald-800",
  late: "bg-amber-50 text-amber-800",
  no_show: "bg-red-50 text-red-800",
};

// When the candidate reached the lobby for each interview, on any job.
function Punctuality({ arrivals, current, zone }: { arrivals: Arrival[]; current: string; zone: string }) {
  const trend = arrivalTrend(arrivals);
  const time = (iso: string) => DateTime.fromISO(iso, { zone }).toFormat("h:mm a");
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-neutral-900">Punctuality</h2>
      <p className="mt-0.5 text-xs text-neutral-500">When the candidate reached the lobby for each interview. Within 2 minutes of the start counts as on time.</p>
      {trend && <p className={`mt-3 text-sm font-medium ${trend.concern ? "text-amber-800" : "text-emerald-800"}`}>{trend.text}</p>}
      <ul className="mt-3 divide-y divide-neutral-100 text-sm">
        {arrivals.map((a) => (
          <li key={a.bookingId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
            <span className={`text-neutral-700 ${a.bookingId === current ? "font-semibold" : ""}`}>
              {stageLabel(a.stage)}
              {a.jobTitle && <span className="font-normal text-neutral-500"> · {a.jobTitle}</span>}
            </span>
            <span className="flex items-center gap-3 text-xs text-neutral-500">
              {DateTime.fromISO(a.slotStart, { zone }).toFormat("d LLL")}: {a.arrivedAt ? `joined ${time(a.arrivedAt)} for ${time(a.slotStart)}` : `booked for ${time(a.slotStart)}`}
              <span className={`rounded-full px-2 py-0.5 font-medium ${ARRIVAL_STYLE[a.outcome]}`}>{arrivalLabel(a)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Timeline({ points, current }: { points: TimelinePoint[]; current: string }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-neutral-900">Likelihood over time</h2>
      <p className="mt-0.5 text-xs text-neutral-500">Before and after each interview for this job.</p>
      <ol className="mt-4 flex items-end gap-3 overflow-x-auto pb-1">
        {points.map((p, i) => {
          const prev = points[i - 1]?.percent;
          const moved = p.percent !== null && prev !== undefined && prev !== null ? p.percent - prev : null;
          const here = p.bookingId === current;
          return (
            <li key={`${p.bookingId}-${p.when}`} className="flex w-24 flex-shrink-0 flex-col items-center gap-1.5">
              <span className="text-sm font-semibold tabular-nums text-neutral-900">
                {p.percent === null ? "?" : `${p.percent}%`}
                {moved !== null && moved !== 0 && (
                  <span className={`ml-1 text-xs ${moved > 0 ? "text-emerald-700" : "text-red-700"}`}>{moved > 0 ? "▲" : "▼"}</span>
                )}
              </span>
              <div className="flex h-28 w-8 items-end rounded bg-neutral-100">
                <div className={`w-full rounded ${p.when === "after" ? "bg-sky-600" : "bg-sky-300"}`} style={{ height: `${p.percent ?? 0}%` }} aria-hidden />
              </div>
              <span className={`text-center text-xs leading-tight ${here ? "font-semibold text-neutral-900" : "text-neutral-500"}`}>
                {p.when === "before" ? "Before" : "After"}
                <br />
                {stageLabel(p.stage)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
