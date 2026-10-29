"use client";

import { useEffect, useState } from "react";

const ZOOM_STEPS = [70, 80, 90, 100, 115, 130, 150, 175, 200];
const ZOOM_KEY = "cosrec:job-zoom";
const BTN =
  "rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-white";

// The job description from JobAdder beside the video, in its own scrolling
// pane, with zoom so it can be read comfortably mid-interview. The zoom level is
// remembered on this computer. html is already cleaned (lib/job-description.ts).
export function JobDescriptionPane({ jobTitle, html }: { jobTitle: string | null; html: string | null }) {
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(ZOOM_KEY));
      // Reading the saved preference once on load.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (ZOOM_STEPS.includes(saved)) setZoom(saved);
    } catch {
      // Storage blocked - just start at 100%.
    }
  }, []);

  function change(next: number) {
    setZoom(next);
    try {
      window.localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      // Not remembered, but still applied.
    }
  }

  const index = ZOOM_STEPS.indexOf(zoom);

  return (
    <section className="flex max-h-[38rem] flex-col rounded-lg border border-neutral-200 bg-white lg:max-h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-900">Job description</h2>
          {jobTitle && <p className="truncate text-xs text-neutral-500">{jobTitle}</p>}
        </div>
        {html && (
          <div className="flex flex-shrink-0 items-center gap-1" role="group" aria-label="Zoom">
            <button type="button" className={BTN} onClick={() => change(ZOOM_STEPS[index - 1]!)} disabled={index <= 0} aria-label="Zoom out">
              A−
            </button>
            <button
              type="button"
              className="w-12 text-center text-xs tabular-nums text-neutral-600 hover:text-neutral-900"
              onClick={() => change(100)}
              title="Reset to 100%"
            >
              {zoom}%
            </button>
            <button
              type="button"
              className={BTN}
              onClick={() => change(ZOOM_STEPS[index + 1]!)}
              disabled={index >= ZOOM_STEPS.length - 1}
              aria-label="Zoom in"
            >
              A+
            </button>
          </div>
        )}
      </div>
      <div className="min-h-[12rem] flex-1 overflow-auto px-4 py-3" tabIndex={0} aria-label="Job description text">
        {html ? (
          <div className="lobby-html text-sm" style={{ zoom: zoom / 100 }} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="text-sm text-neutral-400">
            No job description from JobAdder for this job. Add one to the job in JobAdder and it will show here (within the hour).
          </p>
        )}
      </div>
    </section>
  );
}
