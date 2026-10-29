"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { regenerateReview } from "../actions";

// Regenerate (or write it now), and while a review is being written elsewhere,
// check back every 10 seconds so the page fills in by itself.
export function ReviewControls({ bookingId, label, waiting }: { bookingId: string; label: string; waiting: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [waiting, router]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending || waiting}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await regenerateReview(bookingId);
            if (!res.ok) setError(res.error);
            router.refresh();
          })
        }
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100 disabled:opacity-50"
      >
        {pending ? "Writing the overview… (up to a minute or two)" : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
