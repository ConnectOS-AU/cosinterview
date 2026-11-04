"use client";

export type Standing = {
  // The latest likelihood: after their latest interview once that's written.
  score: number | null;
  // Their latest interview with this recruiter, for the candidate overview.
  overviewId: string | null;
};

// Beside a candidate's name. The profile opens in a new tab so ticked candidates
// stay ticked here.
export function CandidateStanding({ standing }: { standing: Standing }) {
  return (
    <>
      {standing.score !== null && (
        <span
          title="Latest likelihood of being the successful candidate"
          className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-sky-800"
        >
          {standing.score}%
        </span>
      )}
      {standing.overviewId && (
        <a
          href={`/r/bookings/${standing.overviewId}/overview`}
          target="_blank"
          rel="noopener"
          onClick={(e) => e.stopPropagation()}
          className="ml-2 text-xs font-medium text-neutral-600 underline hover:text-neutral-950"
        >
          Profile
        </a>
      )}
    </>
  );
}
