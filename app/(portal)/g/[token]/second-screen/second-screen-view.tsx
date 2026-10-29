"use client";

import { useCompanionWindow, useFullScreen } from "@/lib/companion";
import { CandidateDocs, guestScreenKey } from "../candidate-docs";

const BTN = "rounded-lg border border-brand-line bg-brand-surface px-3 py-1.5 text-xs font-medium text-brand-ink hover:bg-brand-teal-tint";

// Tells the lobby this window is open (so it hides its own copy), and closes
// when the attendee brings the documents back.
export function SecondScreenView({ token, candidateName, jobTitle, jobHtml }: { token: string; candidateName: string; jobTitle: string | null; jobHtml: string | null }) {
  useCompanionWindow(guestScreenKey(token));
  const [fullScreen, toggleFullScreen] = useFullScreen();
  return (
    <main className="min-h-dvh space-y-3 bg-brand-bg p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-medium text-brand-ink">{candidateName}</h1>
          <p className="truncate text-xs text-brand-faint">{jobTitle ?? "Interview"} · Drag this window to your second screen if it opened on this one.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={toggleFullScreen} className={BTN}>
            {fullScreen ? "Exit full screen" : "Full screen"}
          </button>
          <button type="button" onClick={() => window.close()} className={BTN}>
            Close (back to the interview)
          </button>
        </div>
      </div>
      <CandidateDocs token={token} candidateName={candidateName} jobTitle={jobTitle} jobHtml={jobHtml} height="h-[40rem] lg:h-[calc(100vh-5.5rem)]" sideBySide />
    </main>
  );
}
