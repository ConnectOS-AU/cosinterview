"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { DEFAULT_INTERVIEW_LENGTH, INTERVIEW_LENGTHS } from "@/lib/staff/options";
import { isClientStage, STAGES, stageLabel, type Stage } from "@/lib/stages";
import { progressCandidates, type SentInvite } from "../actions";
import { Results } from "./candidate-picker";
import { CandidateStanding, type Standing } from "./candidate-standing";

export type BoardCandidate = {
  candidateId: string;
  name: string;
  email: string | null;
  // JobAdder application status and workflow stage.
  jobAdderStage: string | null;
  unsubscribed: boolean;
  // Their latest interview on this job, e.g. "Interview 1 completed".
  last: string | null;
  next: Stage;
  standing: Standing;
};

export type BoardJob = {
  jobId: string;
  title: string;
  companyName: string | null;
  role: string;
  candidates: BoardCandidate[];
};

const MAX_AT_ONCE = 50;
const pickKey = (jobId: string, candidateId: string) => `${jobId}:${candidateId}`;

// The recruiter's jobs with everyone waiting for a next step. Tick candidates
// on any of the jobs, then send each to their own next stage or one chosen stage.
export function ProgressBoard({ jobs, canEmail, emptyText }: { jobs: BoardJob[]; canEmail: boolean; emptyText: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stage, setStage] = useState<Stage | "">("");
  const [duration, setDuration] = useState<number>(DEFAULT_INTERVIEW_LENGTH);
  const [sendEmail, setSendEmail] = useState(canEmail);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: SentInvite[]; skipped: string[]; failed: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(keys: string[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function submit() {
    const picks = jobs.flatMap((job) =>
      job.candidates
        .filter((c) => selected.has(pickKey(job.jobId, c.candidateId)))
        .map((c) => ({ jobId: job.jobId, candidateId: c.candidateId, stage: stage || c.next })),
    );
    setError(null);
    startTransition(async () => {
      const res = await progressCandidates({ picks, durationMins: duration, sendEmail, message });
      if (!res.ok) setError(res.error);
      else {
        setResult(res);
        setSelected(new Set());
      }
    });
  }

  if (result) return <Results {...result} />;

  if (jobs.length === 0) {
    return <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-500">{emptyText}</p>;
  }

  const count = selected.size;
  const tooMany = count > MAX_AT_ONCE;

  return (
    <div className="space-y-4">
      {jobs.map((job) => {
        const keys = job.candidates.filter((c) => c.email).map((c) => pickKey(job.jobId, c.candidateId));
        const allTicked = keys.length > 0 && keys.every((k) => selected.has(k));
        return (
          <section key={job.jobId} className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5">
              <p className="min-w-0 text-sm">
                <span className="font-medium text-neutral-900">{job.title}</span>
                {job.companyName && <span className="text-neutral-500"> · {job.companyName}</span>}
                <span className="ml-2 rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-medium text-neutral-600">{job.role}</span>
              </p>
              <div className="flex items-center gap-4">
                {keys.length > 1 && (
                  <label className="flex items-center gap-2 text-xs font-medium text-neutral-600">
                    <input
                      type="checkbox"
                      checked={allTicked}
                      onChange={(e) => toggle(keys, e.target.checked)}
                      className="h-4 w-4 rounded border-neutral-300"
                    />
                    Select all
                  </label>
                )}
                <Link href={`/r/interviews/new?job=${job.jobId}`} className="text-xs font-medium text-neutral-600 underline hover:text-neutral-950">
                  All candidates
                </Link>
              </div>
            </div>
            {job.candidates.length === 0 ? (
              <p className="px-4 py-3 text-sm text-neutral-500">Nobody is waiting for a next step.</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {job.candidates.map((c) => {
                  const key = pickKey(job.jobId, c.candidateId);
                  const can = Boolean(c.email);
                  return (
                    <li key={key}>
                      <label className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 ${can ? "cursor-pointer hover:bg-neutral-50" : "text-neutral-400"}`}>
                        <input
                          type="checkbox"
                          aria-label={`Progress ${c.name}`}
                          disabled={!can}
                          checked={selected.has(key)}
                          onChange={(e) => toggle([key], e.target.checked)}
                          className="h-4 w-4 rounded border-neutral-300"
                        />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className={can ? "font-medium text-neutral-900" : "font-medium"}>{c.name}</span>
                          <CandidateStanding standing={c.standing} />
                          {!can && <span className="ml-2 text-xs">No email in JobAdder</span>}
                          {can && c.unsubscribed && <span className="ml-2 text-xs text-amber-700">Unsubscribed from marketing</span>}
                          <span className="block text-xs text-neutral-500">{[c.last ?? "No interviews yet", c.jobAdderStage].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700">
                          {stage && selected.has(key) ? stageLabel(stage) : `Next: ${stageLabel(c.next)}`}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {count > 0 && (
        <div className="sticky bottom-3 z-10 space-y-3 rounded-lg border border-neutral-300 bg-white px-4 py-3 shadow-lg">
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-neutral-700">Progress to</span>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as Stage | "")}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Each candidate&apos;s next stage</option>
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-neutral-700">Interview length</span>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
              >
                {INTERVIEW_LENGTHS.map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[14rem] flex-1 text-sm">
              <span className="mb-1 block font-medium text-neutral-700">Personal message (optional)</span>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={1000}
                placeholder="Shown at the top of each invite email"
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className={`flex items-center gap-2 text-sm ${canEmail ? "text-neutral-700" : "text-neutral-400"}`}>
              <input
                type="checkbox"
                checked={sendEmail}
                disabled={!canEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300"
              />
              Email the invites to candidates
              {!canEmail && <span className="text-xs">(not set up yet - you&apos;ll get links to copy)</span>}
            </label>
            <div className="flex items-center gap-3">
              {tooMany && <span className="text-sm text-red-600">Choose up to {MAX_AT_ONCE} at a time.</span>}
              {error && <span className="text-sm text-red-600">{error}</span>}
              {stage && isClientStage(stage) && <span className="text-xs text-neutral-500">Client attendees are added from the interview page.</span>}
              <button
                type="button"
                onClick={submit}
                disabled={pending || tooMany}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending ? "Progressing…" : `Progress ${count} candidate${count === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
