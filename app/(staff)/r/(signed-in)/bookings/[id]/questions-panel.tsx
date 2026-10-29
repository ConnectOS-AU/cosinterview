"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TOPIC_LABEL } from "@/lib/review-labels";
import type { ReviewQuestion } from "@/lib/worker/review";

const askedKey = (bookingId: string) => `cosrec:asked:${bookingId}`;

function readAsked(bookingId: string): number[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(askedKey(bookingId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === "number") : [];
  } catch {
    return [];
  }
}

// Which questions the interviewer has ticked as asked, remembered on this
// computer and kept in step between the interview screen and the second-screen
// window (the browser's storage event tells the other window).
function useAsked(bookingId: string) {
  const [asked, setAsked] = useState<number[]>([]);

  useEffect(() => {
    // Reading what was ticked before (and in the other window) once on load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAsked(readAsked(bookingId));
    const onStorage = (e: StorageEvent) => {
      if (e.key === askedKey(bookingId)) setAsked(readAsked(bookingId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [bookingId]);

  const toggle = useCallback(
    (index: number) => {
      setAsked((prev) => {
        const next = prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index];
        try {
          window.localStorage.setItem(askedKey(bookingId), JSON.stringify(next));
        } catch {
          // Not remembered, but still ticked here.
        }
        return next;
      });
    },
    [bookingId],
  );

  return { asked, toggle };
}

// The overview's questions, to read to the candidate during the interview.
export function QuestionsPanel({
  bookingId,
  questions,
  reviewStatus,
  sizeClass = "max-h-[28rem]",
}: {
  bookingId: string;
  questions: ReviewQuestion[] | null;
  reviewStatus: string;
  sizeClass?: string;
}) {
  const { asked, toggle } = useAsked(bookingId);
  const count = questions?.length ?? 0;

  return (
    <section className={`flex flex-col rounded-lg border border-neutral-200 bg-white ${sizeClass}`}>
      <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Questions to ask</h2>
          <p className="text-xs text-neutral-500">
            {count ? `${asked.filter((i) => i < count).length} of ${count} asked` : "From the candidate overview"}
          </p>
        </div>
        <Link
          href={`/r/bookings/${bookingId}/overview`}
          target="_blank"
          className="text-xs font-medium text-neutral-600 underline hover:text-neutral-900"
        >
          Candidate overview ↗
        </Link>
      </div>
      <div className="min-h-[8rem] flex-1 overflow-auto px-4 py-3">
        {questions && count > 0 ? (
          <ol className="space-y-3">
            {questions.map((q, i) => {
              const done = asked.includes(i);
              return (
                <li key={i}>
                  <label className="flex cursor-pointer gap-3">
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={() => toggle(i)}
                      className="mt-1 h-4 w-4 flex-shrink-0 rounded border-neutral-300"
                      aria-label={`Asked question ${i + 1}`}
                    />
                    <span className={done ? "text-neutral-400" : ""}>
                      <span className="text-sm text-neutral-900">
                        <span className="font-semibold tabular-nums text-neutral-400">{i + 1}.</span>{" "}
                        <span className={done ? "text-neutral-400 line-through" : ""}>{q.question}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-neutral-500">
                        <span className="mr-1.5 rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">{TOPIC_LABEL[q.topic]}</span>
                        {q.purpose}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-neutral-400">
            {reviewStatus === "pending" || reviewStatus === "running"
              ? "The candidate overview is still being written - its questions will show here when you reload."
              : reviewStatus === "failed"
                ? "The candidate overview couldn't be written, so there are no questions. Try again from the overview."
                : "No questions yet. They come from the candidate overview, written after the candidate books."}
          </p>
        )}
      </div>
    </section>
  );
}
