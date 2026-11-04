import { DateTime } from "luxon";
import { NEXT_STEP_LABEL } from "@/lib/candidate-debrief";
import type { HistoryRound } from "@/lib/interview-history";
import { stageLabel } from "@/lib/stages";
import { formatOffset } from "@/lib/worker/format";
import { RECOMMENDATION, SCORE_LABELS, STATUS_TEXT } from "../interview-record";

type Summary = NonNullable<NonNullable<HistoryRound["record"]>["summary"]>;

const AUTHOR_KIND = { recruiter: "Recruiter", client: "Client", other: "Attendee" } as const;

const percent = (value: number | null) => (value === null ? "?" : `${value}%`);

// Each interview for this job: how the likelihood and scores moved, everyone's
// comments and the transcript. The transcript is here rather than linked because
// a later interview's recruiter can't open another recruiter's booking.
export function InterviewHistory({ rounds, current, zone }: { rounds: HistoryRound[]; current: string; zone: string }) {
  const shown = rounds.filter((r) => r.status === "completed" || r.status === "no_show" || r.notes.length > 0);
  if (shown.length === 0) return null;
  const scored = shown.map((r, i) => shown.slice(0, i).flatMap((p) => p.record?.summary ?? []).at(-1) ?? null);
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-neutral-900">Interview history</h2>
      <p className="mt-0.5 text-xs text-neutral-500">Everyone&apos;s comments, scores and transcripts for this job. The overview for the next interview reads all of this.</p>
      <ol className="mt-3 divide-y divide-neutral-100">
        {shown.map((round, i) => (
          <Round key={round.bookingId} round={round} here={round.bookingId === current} previous={scored[i]} zone={zone} />
        ))}
      </ol>
    </section>
  );
}

function Round({ round, here, previous, zone }: { round: HistoryRound; here: boolean; previous: Summary | null; zone: string }) {
  const summary = round.record?.summary ?? null;
  const verdict = round.debrief ? NEXT_STEP_LABEL[round.debrief.nextStep] : summary ? RECOMMENDATION[summary.recommendation]?.label : null;
  const lines = round.record?.lines ?? [];
  const date = round.slotStart ? DateTime.fromISO(round.slotStart, { zone }).toFormat("d LLL yyyy") : null;
  return (
    <li className="space-y-3 py-4 first:pt-3 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-sm">
          <span className={here ? "font-semibold text-neutral-900" : "font-medium text-neutral-900"}>{stageLabel(round.stage)}</span>
          <span className="text-neutral-500">{[date, round.interviewer && `with ${round.interviewer}`].filter(Boolean).map((t) => ` · ${t}`)}</span>
        </p>
        <p className="flex items-center gap-2 text-xs text-neutral-500">
          {round.status === "no_show" && <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-800">No-show</span>}
          {verdict && <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700">{verdict}</span>}
          {(round.before !== null || round.after !== null) && (
            <span className="font-semibold tabular-nums text-neutral-900">
              {percent(round.before)} → {percent(round.after)}
            </span>
          )}
        </p>
      </div>

      {summary && (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SCORE_LABELS.map(([key, label]) => {
              const moved = previous ? summary.scores[key] - previous.scores[key] : 0;
              return (
                <div key={key} className="rounded-md bg-neutral-50 px-3 py-1.5">
                  <dt className="text-xs text-neutral-500">{label}</dt>
                  <dd className="text-sm font-semibold text-neutral-900">
                    {summary.scores[key]}
                    <span className="text-xs font-normal text-neutral-400">/5</span>
                    {moved !== 0 && (
                      <span className={`ml-1 text-xs ${moved > 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {moved > 0 ? "▲" : "▼"} {Math.abs(moved)}
                      </span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="max-w-3xl text-sm leading-relaxed text-neutral-700">{summary.summary}</p>
        </>
      )}

      <div>
        <h3 className="mb-1 text-xs font-semibold text-neutral-700">Comments</h3>
        {round.notes.length === 0 ? (
          <p className="text-sm text-neutral-400">No comments.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {round.notes.map((note) => (
              <li key={note.id}>
                <span className="text-xs font-semibold text-neutral-500">
                  {note.authorName ?? AUTHOR_KIND[note.authorKind]}
                  {note.authorName && ` (${AUTHOR_KIND[note.authorKind]})`}
                  {note.offsetMs !== null && ` · ${formatOffset(note.offsetMs)}`}
                </span>
                <p className="whitespace-pre-wrap text-neutral-800">{note.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {round.record &&
        (lines.length === 0 ? (
          <p className="text-xs text-neutral-500">{STATUS_TEXT[round.record.status] || "The transcript is empty."}</p>
        ) : (
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-neutral-700 hover:text-neutral-950">Transcript ({lines.length} lines)</summary>
            <ol className="mt-2 max-h-96 space-y-2 overflow-y-auto pr-2 text-sm">
              {lines.map((line, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-12 flex-shrink-0 pt-0.5 font-mono text-xs text-neutral-400">{formatOffset(line.startMs)}</span>
                  <div>
                    <span className={`text-xs font-semibold ${line.speaker === "recruiter" ? "text-neutral-500" : "text-sky-700"}`}>
                      {line.speaker === "recruiter" ? "Recruiter" : "Candidate"}
                    </span>
                    <p className="text-neutral-800">{line.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        ))}
    </li>
  );
}
