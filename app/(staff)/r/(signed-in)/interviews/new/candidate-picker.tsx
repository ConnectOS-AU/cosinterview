"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { DEFAULT_INTERVIEW_LENGTH, INTERVIEW_LENGTHS } from "@/lib/staff/options";
import { createInvitations, type SentInvite } from "../actions";
import { CopyButton } from "../copy-button";

type Candidate = {
  candidateId: string;
  name: string;
  email: string | null;
  stage: string | null;
  unsubscribed: boolean;
  invitedLabel: string | null;
};

export function CandidatePicker({ jobId, candidates, canEmail }: { jobId: string; candidates: Candidate[]; canEmail: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [duration, setDuration] = useState<number>(DEFAULT_INTERVIEW_LENGTH);
  const [sendEmail, setSendEmail] = useState(canEmail);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: SentInvite[]; skipped: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const selectable = (c: Candidate) => Boolean(c.email) && !c.invitedLabel;
  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return term ? candidates.filter((c) => `${c.name} ${c.email ?? ""} ${c.stage ?? ""}`.toLowerCase().includes(term)) : candidates;
  }, [candidates, filter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createInvitations({ jobId, durationMins: duration, candidateIds: [...selected], sendEmail, message });
      if (!res.ok) setError(res.error);
      else {
        setResult(res);
        setSelected(new Set());
      }
    });
  }

  if (result) return <Results {...result} />;

  if (candidates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-500">
        Nobody has an active application on this job in JobAdder yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
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
        <label className="flex-1 text-sm">
          <span className="mb-1 block font-medium text-neutral-700">Filter</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Name, email or stage"
            className="w-full max-w-xs rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="w-10 px-4 py-2.5" />
              <th className="px-4 py-2.5">Candidate</th>
              <th className="hidden px-4 py-2.5 sm:table-cell">Email</th>
              <th className="px-4 py-2.5">JobAdder status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {visible.map((c) => {
              const can = selectable(c);
              return (
                <tr key={c.candidateId} className={can ? "cursor-pointer hover:bg-neutral-50" : "text-neutral-400"} onClick={() => can && toggle(c.candidateId)}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Invite ${c.name}`}
                      disabled={!can}
                      checked={selected.has(c.candidateId)}
                      onChange={() => toggle(c.candidateId)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-neutral-300"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className={can ? "font-medium text-neutral-900" : "font-medium"}>{c.name}</span>
                    {c.invitedLabel && (
                      <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{c.invitedLabel}</span>
                    )}
                    {!c.email && <span className="ml-2 text-xs">No email in JobAdder</span>}
                    {c.unsubscribed && c.email && <span className="ml-2 text-xs text-amber-700">Unsubscribed from marketing</span>}
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">{c.email ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3">{c.stage ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <label className="block space-y-1.5 rounded-lg border border-neutral-200 bg-white px-4 py-3">
        <span className="text-sm font-medium text-neutral-800">Personal message (optional)</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="e.g. Great to see your application - I think your Xero experience is a strong fit for this client."
          className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
        />
        <span className="block text-xs text-neutral-500">
          {sendEmail && canEmail
            ? "Shown at the top of each invite email, above the booking button. Every selected candidate gets the same message."
            : "Only used in emailed invites - it isn't added to copied links."}
        </span>
      </label>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-3">
        <label className={`flex items-center gap-2 text-sm ${canEmail ? "text-neutral-700" : "text-neutral-400"}`}>
          <input
            type="checkbox"
            checked={sendEmail}
            disabled={!canEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300"
          />
          Email the invites from my Outlook
          {!canEmail && <span className="text-xs">(not set up yet - you&apos;ll get links to copy)</span>}
        </label>
        <div className="flex items-center gap-3">
          {error && <span className="text-sm text-red-600">{error}</span>}
          <button
            type="button"
            onClick={submit}
            disabled={pending || selected.size === 0}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending
              ? "Inviting…"
              : selected.size === 0
                ? "Invite candidates"
                : `Invite ${selected.size} candidate${selected.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Results({ sent, skipped }: { sent: SentInvite[]; skipped: string[] }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        {sent.length === 0
          ? "Nobody new was invited."
          : `${sent.length} candidate${sent.length === 1 ? "" : "s"} invited.`}{" "}
        Each link is personal and only shown now - copy any you need to send yourself.
      </div>
      {sent.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
          {sent.map((s) => (
            <li key={s.link} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium text-neutral-900">{s.name}</p>
                <p className="text-xs text-neutral-500">
                  {s.email} · {s.emailed ? "Emailed" : s.error ?? "Not emailed"}
                </p>
              </div>
              <CopyButton value={s.link} />
            </li>
          ))}
        </ul>
      )}
      {skipped.length > 0 && <p className="text-sm text-neutral-500">Skipped (already invited or no email): {skipped.join(", ")}.</p>}
      <div className="flex gap-3">
        <Link href="/r" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          Back to interviews
        </Link>
        <Link href="/r/interviews/new" className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
          Invite for another job
        </Link>
      </div>
    </div>
  );
}
