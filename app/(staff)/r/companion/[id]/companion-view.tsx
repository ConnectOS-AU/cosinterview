"use client";

import { useEffect, useState } from "react";
import type { ReviewQuestion } from "@/lib/worker/review";
import { companionChannel, HEARTBEAT_MS, type CompanionMessage } from "../../(signed-in)/bookings/[id]/interview-aside";
import { JobDescriptionPane } from "../../(signed-in)/bookings/[id]/job-description-pane";
import { QuestionsPanel } from "../../(signed-in)/bookings/[id]/questions-panel";

const FULL = "max-h-none lg:h-[calc(100vh-5.5rem)]";

// Tells the interview screen this window is open (so it hides its own copy),
// and closes when the interviewer brings the panels back.
export function CompanionView({
  bookingId,
  candidateName,
  jobTitle,
  jobHtml,
  questions,
  reviewStatus,
}: {
  bookingId: string;
  candidateName: string;
  jobTitle: string | null;
  jobHtml: string | null;
  questions: ReviewQuestion[] | null;
  reviewStatus: string;
}) {
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(companionChannel(bookingId));
    const say = (type: CompanionMessage["type"]) => bc.postMessage({ type } satisfies CompanionMessage);
    bc.onmessage = (e: MessageEvent<CompanionMessage>) => {
      if (e.data.type === "ping") say("open");
      if (e.data.type === "close") window.close();
    };
    say("open");
    // A heartbeat, so the interview screen notices if this window goes
    // without saying goodbye (crash, killed tab).
    const heartbeat = setInterval(() => say("open"), HEARTBEAT_MS);
    const onHide = () => say("closed");
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("pagehide", onHide);
      say("closed");
      bc.close();
    };
  }, [bookingId]);

  useEffect(() => {
    const onChange = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  return (
    <main className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-neutral-900">{candidateName}</h1>
          <p className="truncate text-xs text-neutral-500">
            {jobTitle ?? "Interview"} · Drag this window to your second screen if it opened on this one.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => (fullScreen ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined)}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
          >
            {fullScreen ? "Exit full screen" : "Full screen"}
          </button>
          <button
            type="button"
            onClick={() => window.close()}
            className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
          >
            Close (back to the interview screen)
          </button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <JobDescriptionPane jobTitle={jobTitle} html={jobHtml} sizeClass={`max-h-[40rem] ${FULL}`} />
        <QuestionsPanel bookingId={bookingId} questions={questions} reviewStatus={reviewStatus} sizeClass={`max-h-[40rem] ${FULL}`} />
      </div>
    </main>
  );
}
