"use client";

import { useState, useTransition } from "react";
import type { LinkedinCheck, LinkedinOutcome } from "@/lib/linkedin-check";
import { recordLinkedinCheck } from "./actions";

const OUTCOMES: { value: LinkedinOutcome; label: string }[] = [
  { value: "matches", label: "Matches the resume" },
  { value: "differences", label: "Differences found" },
  { value: "not_found", label: "Couldn't find or open the profile" },
];

const LABEL: Record<LinkedinOutcome, string> = {
  matches: "Matches the resume",
  differences: "Differences from the resume",
  not_found: "Profile couldn't be found or opened",
};

// The mandatory LinkedIn check: the recruiter compares the profile with the
// resume and records what they found. Until then, Join interview is locked.
export function LinkedinCheckPanel({
  bookingId,
  url,
  check,
  onChecked,
}: {
  bookingId: string;
  url: string;
  check: LinkedinCheck | null;
  onChecked: (check: LinkedinCheck) => void;
}) {
  const [editing, setEditing] = useState(!check);
  const [outcome, setOutcome] = useState<LinkedinOutcome | null>(check?.outcome ?? null);
  const [note, setNote] = useState(check?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (check && !editing) {
    const tone = check.outcome === "matches" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900";
    return (
      <section className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-sm ${tone}`}>
        <p>
          <span className="font-semibold">LinkedIn checked:</span> {LABEL[check.outcome]}
          {check.note && <span> - {check.note}</span>}
          <span className="text-xs opacity-75">
            {" "}
            · {check.checkedBy}, {new Date(check.checkedAt).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
          </span>
        </p>
        <div className="flex items-center gap-3 text-xs">
          <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
            Open profile ↗
          </a>
          <button type="button" onClick={() => setEditing(true)} className="underline">
            Change
          </button>
        </div>
      </section>
    );
  }

  function save() {
    if (!outcome) {
      setError("Choose what you found.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await recordLinkedinCheck(bookingId, outcome, note);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      onChecked(res.check);
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-amber-900">LinkedIn check {check ? "" : "required before you join"}</p>
        <p className="mt-0.5 text-sm text-amber-900">
          <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
            Open their LinkedIn profile ↗
          </a>{" "}
          and compare it with the resume: employers, job titles, dates, education and certifications.
        </p>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {OUTCOMES.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm text-neutral-800">
            <input type="radio" name="linkedin-outcome" checked={outcome === o.value} onChange={() => setOutcome(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
      {outcome && outcome !== "matches" && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder={outcome === "differences" ? "What's different? e.g. LinkedIn shows a different employer for 2021-2023" : "What happened? e.g. the link is broken, no profile under that name"}
          className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-amber-500 focus:outline-none"
        />
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Record LinkedIn check"}
        </button>
        {check && (
          <button type="button" onClick={() => setEditing(false)} className="text-sm text-amber-900 underline">
            Cancel
          </button>
        )}
        <p className="text-xs text-amber-800">Added to the candidate&apos;s JobAdder notes and the overview after the interview.</p>
      </div>
    </section>
  );
}
