"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { regenerateDebrief, regenerateReview } from "../actions";

// Regenerate (or write it now) - the pre-interview overview, or with `after`
// the one after the interview - and while one is being written elsewhere,
// check back every 10 seconds so the page fills in by itself.
export function ReviewControls({ bookingId, label, waiting, after = false }: { bookingId: string; label: string; waiting: boolean; after?: boolean }) {
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
            const res = await (after ? regenerateDebrief : regenerateReview)(bookingId);
            if (!res.ok) setError(res.error);
            router.refresh();
          })
        }
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100 disabled:opacity-50"
      >
        {pending ? `Writing the ${after ? "post-interview " : ""}overview… (up to a minute or two)` : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
