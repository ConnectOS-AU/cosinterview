import Link from "next/link";
import { DateTime } from "luxon";
import { requireRecruiter } from "@/lib/staff/auth";
import { graphConfigured } from "@/lib/graph";
import { listBookingsForRecruiter, type BookingSummary } from "@/lib/staff/repo";
import { STATUS_BADGE } from "@/lib/staff/status";
import { BookingActions } from "./interviews/booking-actions";

export const dynamic = "force-dynamic";

export default async function InterviewsPage() {
  const { recruiter } = await requireRecruiter();
  const bookings = await listBookingsForRecruiter(recruiter.id);
  const now = DateTime.utc();

  const isOpen = (b: BookingSummary) =>
    (b.status === "booked" || b.status === "in_progress") &&
    b.slotEnd !== null &&
    DateTime.fromISO(b.slotEnd).plus({ hours: 1 }) > now;
  const upcoming = bookings.filter(isOpen);
  const awaiting = bookings.filter((b) => b.status === "invited");
  const past = bookings.filter((b) => !isOpen(b) && b.status !== "invited").reverse();
  const canEmail = graphConfigured();

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Interviews</h1>
          <p className="mt-1 text-sm text-neutral-500">Times shown in {recruiter.timezone.replace(/_/g, " ")} time.</p>
        </div>
        <Link href="/r/interviews/new" className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          New interview
        </Link>
      </div>
      <Section title="Upcoming" empty="No interviews booked yet." rows={upcoming} zone={recruiter.timezone} canEmail={canEmail} highlightJoin />
      <Section title="Waiting for the candidate to book" empty="Nobody waiting." rows={awaiting} zone={recruiter.timezone} canEmail={canEmail} />
      <Section title="Past 30 days" empty="Nothing in the last 30 days." rows={past} zone={recruiter.timezone} canEmail={canEmail} />
    </main>
  );
}

function Section({
  title,
  empty,
  rows,
  zone,
  canEmail,
  highlightJoin = false,
}: {
  title: string;
  empty: string;
  rows: BookingSummary[];
  zone: string;
  canEmail: boolean;
  highlightJoin?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-neutral-700">{title}</h2>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-500">
          {empty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2.5">Candidate</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">Role</th>
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {rows.map((b) => {
                const badge = STATUS_BADGE[b.status];
                return (
                  <tr key={b.bookingId} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-900">{b.candidateName}</td>
                    <td className="hidden px-4 py-3 text-neutral-700 sm:table-cell">
                      {b.jobTitle ?? "—"}
                      {b.clientName && <span className="text-neutral-400"> · {b.clientName}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-700">
                      {b.slotStart
                        ? DateTime.fromISO(b.slotStart, { zone }).toFormat("ccc d LLL, h:mm a")
                        : b.status === "invited" && b.inviteExpiresAt
                          ? `Link ${DateTime.fromISO(b.inviteExpiresAt) < DateTime.utc() ? "expired" : "expires"} ${DateTime.fromISO(b.inviteExpiresAt, { zone }).toFormat("d LLL")}`
                          : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-start justify-end gap-4">
                        <BookingActions bookingId={b.bookingId} status={b.status} canEmail={canEmail} />
                        {b.status !== "invited" && b.status !== "cancelled" && (
                          <Link
                            href={`/r/bookings/${b.bookingId}`}
                            className={
                              highlightJoin
                                ? "inline-flex rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800"
                                : "text-xs font-medium text-neutral-700 underline hover:text-neutral-950"
                            }
                          >
                            {highlightJoin ? "Open" : "View"}
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
