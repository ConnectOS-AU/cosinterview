"use client";

import { useState, type ReactNode } from "react";

// The channel the client lobby and its second-screen window talk on.
export const guestScreenKey = (token: string) => `guest:${token.slice(0, 16)}`;

// The candidate's resume and the job description: side by side in the
// second-screen window. In the client lobby only the resume (resumeOnly) - the
// job description is a link there, so the video keeps the space.
export function CandidateDocs({
  token,
  candidateName,
  jobTitle,
  jobHtml,
  height,
  sideBySide = false,
  resumeOnly = false,
}: {
  token: string;
  candidateName: string;
  jobTitle: string | null;
  jobHtml: string | null;
  height: string;
  sideBySide?: boolean;
  resumeOnly?: boolean;
}) {
  const [tab, setTab] = useState<"resume" | "job">("resume");
  const resumeUrl = `/g/${token}/resume`;

  const resume = (
    <Pane
      title="Resume"
      subtitle={candidateName}
      height={height}
      action={
        <a href={resumeUrl} target="_blank" rel="noopener" className="text-xs font-medium text-brand-teal underline">
          Open in a new tab ↗
        </a>
      }
    >
      <iframe src={resumeUrl} title={`${candidateName}'s resume`} className="h-full w-full rounded-b-2xl bg-white" />
    </Pane>
  );
  const job = (
    <Pane title="Job description" subtitle={jobTitle} height={height}>
      <div className="h-full overflow-auto px-5 py-4">
        {jobHtml ? (
          <div className="lobby-html text-sm" dangerouslySetInnerHTML={{ __html: jobHtml }} />
        ) : (
          <p className="text-sm text-brand-muted">The job description isn&apos;t available right now.</p>
        )}
      </div>
    </Pane>
  );

  if (resumeOnly) return resume;
  if (sideBySide) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {resume}
        {job}
      </div>
    );
  }
  const tabClass = (on: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${on ? "bg-brand-teal text-brand-on-teal" : "text-brand-muted hover:bg-brand-teal-tint"}`;
  return (
    <div className="space-y-2">
      <div className="flex gap-1" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "resume"} className={tabClass(tab === "resume")} onClick={() => setTab("resume")}>
          Resume
        </button>
        <button type="button" role="tab" aria-selected={tab === "job"} className={tabClass(tab === "job")} onClick={() => setTab("job")}>
          Job description
        </button>
      </div>
      {/* Both stay mounted so the resume doesn't reload when switching. */}
      <div className={tab === "resume" ? "" : "hidden"}>{resume}</div>
      <div className={tab === "job" ? "" : "hidden"}>{job}</div>
    </div>
  );
}

function Pane({ title, subtitle, height, action, children }: { title: string; subtitle: string | null; height: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={`flex flex-col rounded-2xl border border-brand-line bg-brand-surface shadow-card ${height}`}>
      <div className="flex items-center justify-between gap-2 border-b border-brand-line px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-brand-ink">{title}</h2>
          {subtitle && <p className="truncate text-xs text-brand-faint">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}
