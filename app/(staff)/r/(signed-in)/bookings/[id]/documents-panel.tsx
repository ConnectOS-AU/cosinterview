"use client";

import { useState, useTransition } from "react";
import type { LinkedinPdf } from "@/lib/linkedin-pdf";
import type { ResumeVersion } from "@/lib/resumes";
import { chooseClientResume } from "./actions";
import { LinkedinPdfRow } from "./linkedin-pdf-panel";

const DOC_LINK = "font-medium text-neutral-800 underline hover:text-neutral-950";
const formatDate = (iso: string) => new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(iso));

// Everything about the candidate in one place: their resumes and cover letter
// on JobAdder, the job description, the LinkedIn PDF and the candidate overview.
// The recruiter can open any resume version and chooses which formatted one
// extra attendees (clients and others) see in their lobby - they never see the
// original.
export function DocumentsPanel({
  bookingId,
  versions,
  coverLetters,
  problem,
  clientChoice,
  forClients,
  linkedinPdf,
  canUpload,
}: {
  bookingId: string;
  versions: ResumeVersion[];
  coverLetters: ResumeVersion[];
  problem: string | null;
  clientChoice: string | null;
  forClients: boolean;
  linkedinPdf: LinkedinPdf | null;
  canUpload: boolean;
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
      <h2 className="text-sm font-semibold text-neutral-900">Documents</h2>
      <ul className="mt-2 divide-y divide-neutral-100 text-sm">
        {versions.length === 0 && <li className="py-2 text-xs text-neutral-500">{problem ?? "No resume on JobAdder."}</li>}
        {versions.map((v) => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <a href={`/r/bookings/${bookingId}/resume/${encodeURIComponent(v.id)}`} target="_blank" rel="noopener" className={`truncate ${DOC_LINK}`}>
                {v.fileName}
              </a>
              <p className="text-xs text-neutral-500">
                <span className={`mr-1.5 rounded px-1.5 py-px font-medium ${v.formatted ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"}`}>
                  {v.formatted ? "Formatted resume" : "Original resume"}
                </span>
                {v.createdAt && formatDate(v.createdAt)}
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
        {coverLetters.map((c) => (
          <li key={c.id} className="py-2">
            <a href={`/r/bookings/${bookingId}/resume/${encodeURIComponent(c.id)}`} target="_blank" rel="noopener" className={DOC_LINK}>
              {c.fileName}
            </a>
            <p className="text-xs text-neutral-500">
              <span className="mr-1.5 rounded bg-neutral-100 px-1.5 py-px font-medium text-neutral-600">Cover letter</span>
              {c.createdAt && formatDate(c.createdAt)}
            </p>
          </li>
        ))}
        {coverLetters.length === 0 && <li className="py-2 text-xs text-neutral-500">No cover letter on JobAdder.</li>}
        <li className="py-2">
          <a href={`/r/companion/${bookingId}/job`} target="_blank" rel="noopener" className={DOC_LINK}>
            Job description
          </a>
        </li>
        <li className="py-2">
          <a href={`/r/bookings/${bookingId}/overview`} target="_blank" rel="noopener" className={DOC_LINK}>
            Candidate overview
          </a>
        </li>
        {canUpload && <LinkedinPdfRow bookingId={bookingId} pdf={linkedinPdf} />}
      </ul>
      {forClients && versions.length > 0 && formatted.length === 0 && (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          No formatted resume on JobAdder yet. Client and other attendees only see a formatted resume, so they&apos;ll see none until one is added.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
