"use client";

import { useEffect, useState } from "react";

const WARN_MS = 5 * 60_000;

// "4:07", "1:02:30"
function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// Counts down to the booked end time: "Starts in" before the start, the time
// left during it (amber, with a one-off banner, from 5 minutes to go), then
// "Over by" in red. Uses the recruiter's clock; nothing is sent anywhere.
export function InterviewTimer({ slotStart, slotEnd, zone }: { slotStart: string; slotEnd: string; zone: string }) {
  // Set after mounting, so the server render and the first client render match.
  const [now, setNow] = useState<number | null>(null);
  const [warningClosed, setWarningClosed] = useState(false);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  if (now === null) return <div className="h-9" aria-hidden />;
  const start = Date.parse(slotStart);
  const end = Date.parse(slotEnd);
  const endsAt = new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: zone }).format(end).toLowerCase();
  const left = end - now;
  const before = now < start;
  const warning = !before && left > 0 && left <= WARN_MS;
  const over = left <= 0;

  const pill = before
    ? "bg-neutral-100 text-neutral-700 ring-neutral-200"
    : over
      ? "bg-red-50 text-red-800 ring-red-200"
      : warning
        ? "bg-amber-50 text-amber-900 ring-amber-300"
        : "bg-emerald-50 text-emerald-800 ring-emerald-200";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span role="timer" aria-live="off" className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${pill}`}>
          <span className={`h-2 w-2 rounded-full ${before ? "bg-neutral-400" : over ? "bg-red-600" : warning ? "animate-pulse bg-amber-500 motion-reduce:animate-none" : "bg-emerald-600"}`} />
          {before ? (
            <>Starts in {clock(start - now)}</>
          ) : over ? (
            <>Over by {clock(-left)}</>
          ) : (
            <>
              <span className="tabular-nums">{clock(left)}</span> left
            </>
          )}
        </span>
        <span className="text-xs text-neutral-500">Scheduled to end at {endsAt}</span>
      </div>
      {warning && !warningClosed && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5">
          <p className="text-sm font-medium text-amber-900">5 minutes left - time to start wrapping up. The interview is booked until {endsAt}.</p>
          <button type="button" onClick={() => setWarningClosed(true)} className="text-xs font-medium text-amber-900 underline hover:text-amber-950">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
