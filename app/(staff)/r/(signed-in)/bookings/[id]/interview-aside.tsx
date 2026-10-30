"use client";

import { useSecondScreen } from "@/lib/companion";
import type { ReviewQuestion } from "@/lib/worker/review";
import { QuestionsPanel } from "./questions-panel";

// Beside the video: a link to the job description (its own tab, so the video
// keeps the space) and the questions to ask. "Second screen" moves both into
// their own window - on the other monitor where the browser allows it (Window
// Management permission), otherwise wherever the interviewer drags it - and
// this column steps aside until it's closed.
export function InterviewAside({
  bookingId,
  questions,
  reviewStatus,
}: {
  bookingId: string;
  questions: ReviewQuestion[] | null;
  reviewStatus: string;
}) {
  const { popped, error, open: openSecondScreen, bringBack, focus } = useSecondScreen(bookingId, `/r/companion/${bookingId}`);

  if (popped) {
    return (
      <section className="space-y-3 rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-5 text-sm text-neutral-600">
        <p>The job description and questions are open in their own window, on your second screen.</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={focus}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
          >
            Show that window
          </button>
          <button type="button" onClick={bringBack} className="text-xs font-medium text-neutral-700 underline hover:text-neutral-950">
            Bring them back here
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {error && <span className="text-xs text-red-600">{error}</span>}
        <a
          href={`/r/companion/${bookingId}/job`}
          target="_blank"
          rel="noopener"
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
        >
          Job description ↗
        </a>
        <button
          type="button"
          onClick={openSecondScreen}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
          title="Open the job description and questions in their own window, to put on a second monitor"
        >
          Move to second screen ⧉
        </button>
      </div>
      <QuestionsPanel bookingId={bookingId} questions={questions} reviewStatus={reviewStatus} sizeClass="max-h-[28rem] lg:max-h-[calc(100dvh-6rem)]" />
    </>
  );
}
