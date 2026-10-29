import type { InterviewRecord } from "@/lib/staff/transcripts";
import type { InterviewNote } from "@/lib/types";
import { formatOffset } from "@/lib/worker/format";
import { SendToJobAdder } from "./send-to-jobadder";

const STATUS_TEXT: Record<InterviewRecord["status"], string> = {
  none: "No recording was made for this interview.",
  pending: "Waiting for Daily to finish the recording…",
  downloading: "Fetching the recording…",
  translating: "Translating and transcribing…",
  summarising: "Writing the summary…",
  done: "",
  failed: "Transcription failed.",
};

const RECOMMENDATION: Record<string, { label: string; className: string }> = {
  progress: { label: "Progress", className: "bg-emerald-50 text-emerald-700" },
  maybe: { label: "Maybe", className: "bg-amber-50 text-amber-700" },
  do_not_progress: { label: "Don't progress", className: "bg-red-50 text-red-700" },
};

const SCORE_LABELS = [
  ["communication", "Communication"],
  ["englishFluency", "English"],
  ["relevantExperience", "Experience"],
  ["motivation", "Motivation"],
] as const;

// The finished interview: summary on the left, notes and transcript on the right.
export function InterviewRecordView({ bookingId, record, notes }: { bookingId: string; record: InterviewRecord; notes: InterviewNote[] }) {
  const s = record.summary;
  const rec = s ? RECOMMENDATION[s.recommendation] : null;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-900">Summary</h2>
          {rec && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${rec.className}`}>{rec.label}</span>}
        </div>
        {s ? (
          <>
            <p className="text-sm leading-relaxed text-neutral-800">{s.summary}</p>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SCORE_LABELS.map(([key, label]) => (
                <div key={key} className="rounded-md bg-neutral-50 px-3 py-2">
                  <dt className="text-xs text-neutral-500">{label}</dt>
                  <dd className="text-lg font-semibold text-neutral-900">
                    {s.scores[key]}
                    <span className="text-xs font-normal text-neutral-400">/5</span>
                  </dd>
                </div>
              ))}
            </dl>
            <List title="Strengths" items={s.strengths} />
            <List title="Concerns" items={s.concerns} />
            <p className="text-xs text-neutral-400">
              Generated from the translated transcript - check it against the transcript before relying on it.
            </p>
            <SendToJobAdder bookingId={bookingId} sentAt={s.writtenToJobAdderAt} />
          </>
        ) : (
          <p className="text-sm text-neutral-500">
            {record.status === "done" ? "No summary for this interview." : STATUS_TEXT[record.status]}
            {record.status === "failed" && record.error && (
              <span className="mt-1 block text-xs text-red-600">{record.error}</span>
            )}
          </p>
        )}
      </section>

      <div className="space-y-5">
        {notes.length > 0 && (
          <section className="rounded-lg border border-neutral-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-neutral-900">Your notes</h2>
            <ul className="space-y-2 text-sm">
              {notes.map((n) => (
                <li key={n.id} className="flex gap-3">
                  <span className="w-12 flex-shrink-0 font-mono text-xs text-neutral-400">
                    {n.offsetMs === null ? "" : formatOffset(n.offsetMs)}
                  </span>
                  <span className="whitespace-pre-wrap text-neutral-800">{n.body}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-lg border border-neutral-200 bg-white p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-neutral-900">Transcript (English)</h2>
            {record.durationSecs ? <span className="text-xs text-neutral-500">{formatOffset(record.durationSecs * 1000)} long</span> : null}
          </div>
          {record.lines.length === 0 ? (
            <p className="text-sm text-neutral-500">{STATUS_TEXT[record.status] || "The transcript is empty."}</p>
          ) : (
            <ol className="max-h-[32rem] space-y-3 overflow-y-auto pr-2 text-sm">
              {record.lines.map((line, i) => (
                <li key={i} className="flex gap-3">
                  <span className="w-12 flex-shrink-0 pt-0.5 font-mono text-xs text-neutral-400">{formatOffset(line.startMs)}</span>
                  <div>
                    <span className={`text-xs font-semibold ${line.speaker === "recruiter" ? "text-neutral-500" : "text-sky-700"}`}>
                      {line.speaker === "recruiter" ? "You" : "Candidate"}
                    </span>
                    <p className="text-neutral-800">{line.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-neutral-400">Translated from English and Tagalog by Whisper. Wording may differ from what was said.</p>
        </section>
      </div>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-neutral-800">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
