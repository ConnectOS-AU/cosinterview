"use client";

import { DateTime } from "luxon";
import { useState, useTransition } from "react";
import { sendSummaryToJobAdder } from "./actions";

export function SendToJobAdder({ bookingId, sentAt }: { bookingId: string; sentAt: string | null }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(sentAt);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return <p className="text-xs text-emerald-700">Added to JobAdder {DateTime.fromISO(done).toRelative()}.</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await sendSummaryToJobAdder(bookingId);
            if (res.ok) setDone(new Date().toISOString());
            else setError(res.error);
          })
        }
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add summary to JobAdder"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
