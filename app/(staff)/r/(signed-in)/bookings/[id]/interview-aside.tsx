"use client";

import { useSecondScreen } from "@/lib/companion";
import type { ReviewQuestion } from "@/lib/worker/review";
import { JobDescriptionPane } from "./job-description-pane";
import { QuestionsPanel } from "./questions-panel";

// Beside the video: the job description and the questions to ask. "Second
// screen" moves both into their own window - on the other monitor where the
// browser allows it (Window Management permission), otherwise wherever the
// interviewer drags it - and this column steps aside until it's closed.
export function InterviewAside({
  bookingId,
  jobTitle,
  jobHtml,
  questions,
  reviewStatus,
}: {
  bookingId: string;
  jobTitle: string | null;
  jobHtml: string | null;
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
      <div className="flex items-center justify-end gap-3">
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button
          type="button"
          onClick={openSecondScreen}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
          title="Open the job description and questions in their own window, to put on a second monitor"
        >
          Move to second screen ⧉
        </button>
      </div>
      <JobDescriptionPane jobTitle={jobTitle} html={jobHtml} sizeClass="max-h-[30rem] lg:max-h-[calc(55vh)]" />
      <QuestionsPanel bookingId={bookingId} questions={questions} reviewStatus={reviewStatus} sizeClass="max-h-[28rem] lg:max-h-[calc(45vh-6rem)]" />
    </>
  );
}
