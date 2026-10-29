"use client";

import { useState, useTransition } from "react";
import type { ResumeVersion } from "@/lib/resumes";
import { chooseClientResume } from "./actions";

// The candidate's resumes on JobAdder. The recruiter can open any version and
// chooses which formatted one extra attendees (clients and others) see in
// their lobby - they never see the original.
export function ResumesPanel({
  bookingId,
  versions,
  problem,
  clientChoice,
  forClients,
}: {
  bookingId: string;
  versions: ResumeVersion[];
  problem: string | null;
  clientChoice: string | null;
  forClients: boolean;
}) {
  const formatted = versions.filter((v) => v.formatted);
  const [choice, setChoice] = useState<string | null>(formatted.some((v) => v.id === clientChoice) ? clientChoice : null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // What clients actually get: the chosen one, or the newest formatted.
  const shown = choice ?? formatted[0]?.id ?? null;

  function choose(id: string) {
    const next = id === formatted[0]?.id ? null : id;
    const before = choice;
    setChoice(next);
    setError(null);
    startTransition(async () => {
      const res = await chooseClientResume(bookingId, next);
      if (!res.ok) {
        setChoice(before);
        setError(res.error);
      }
    });
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">Resumes</h2>
      {versions.length === 0 ? (
        <p className="mt-1 text-xs text-neutral-500">{problem ?? "No resume on JobAdder."}</p>
      ) : (
        <ul className="mt-2 divide-y divide-neutral-100 text-sm">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <a
                  href={`/r/bookings/${bookingId}/resume/${encodeURIComponent(v.id)}`}
                  target="_blank"
                  rel="noopener"
                  className="truncate font-medium text-neutral-800 underline hover:text-neutral-950"
                >
                  {v.fileName}
                </a>
                <p className="text-xs text-neutral-500">
                  <span className={`mr-1.5 rounded px-1.5 py-px font-medium ${v.formatted ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"}`}>
                    {v.formatted ? "Formatted" : "Original"}
                  </span>
                  {v.createdAt && new Date(v.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              {forClients && v.formatted && (
                <label className="flex items-center gap-1.5 text-xs text-neutral-700">
                  <input type="radio" name={`client-resume-${bookingId}`} checked={shown === v.id} disabled={pending} onChange={() => choose(v.id)} />
                  Attendees see this
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
      {forClients && versions.length > 0 && formatted.length === 0 && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No formatted resume on JobAdder yet. Client and other attendees only see a formatted resume, so they&apos;ll see none until one is added.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
