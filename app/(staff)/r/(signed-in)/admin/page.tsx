import { DateTime } from "luxon";
import { notFound } from "next/navigation";
import { getStaff } from "@/lib/staff/auth";
import { listRecruiters, listUpcomingBookings } from "@/lib/staff/repo";
import { STATUS_BADGE } from "@/lib/staff/status";
import { workAs } from "./actions";
import { AccessToggle, AddRecruiterForm } from "./admin-forms";

export const dynamic = "force-dynamic";

const BUTTON = "text-xs font-medium text-neutral-700 underline hover:text-neutral-950";

// Recruitment admins: the recruiter list, everyone's upcoming interviews, and
// "Work as" to set up interviews or edit a profile on a recruiter's behalf.
export default async function AdminPage() {
  const staff = await getStaff();
  if (!staff?.own?.isAdmin) notFound();
  const [recruiters, upcoming] = await Promise.all([listRecruiters(), listUpcomingBookings()]);
  const zone = staff.own.timezone;
  const ownId = staff.own.id;

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">Admin</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Manage recruiters and see everyone&apos;s interviews. <strong>Work as</strong> opens a recruiter&apos;s screens so you
          can set up interviews or edit their profile for them.
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Upcoming interviews</h2>
        {upcoming.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-500">
            Nothing booked.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-2.5">When ({zone.replace(/_/g, " ")})</th>
                  <th className="px-4 py-2.5">Recruiter</th>
                  <th className="px-4 py-2.5">Candidate</th>
                  <th className="hidden px-4 py-2.5 sm:table-cell">Role</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {upcoming.map((b) => {
                  const badge = STATUS_BADGE[b.status];
                  return (
                    <tr key={b.bookingId} className="hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3 text-neutral-700">
                        {DateTime.fromISO(b.slotStart!, { zone }).toFormat("ccc d LLL, h:mm a")}
                      </td>
                      <td className="px-4 py-3 text-neutral-700">{b.recruiterName}</td>
                      <td className="px-4 py-3 font-medium text-neutral-900">{b.candidateName}</td>
                      <td className="hidden px-4 py-3 text-neutral-700 sm:table-cell">
                        {b.jobTitle ?? "—"}
                        {b.clientName && <span className="text-neutral-400"> · {b.clientName}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <form action={workAs.bind(null, b.recruiterId, `/r/bookings/${b.bookingId}`)}>
                          <button type="submit" className={BUTTON}>
                            Open
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Recruiters</h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-medium uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Active</th>
                <th className="px-4 py-2.5">Admin</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {recruiters.map((r) => (
                <tr key={r.id} className={r.active ? "hover:bg-neutral-50" : "bg-neutral-50 text-neutral-400"}>
                  <td className="px-4 py-3">
                    <span className={r.active ? "font-medium text-neutral-900" : "font-medium"}>{r.displayName}</span>
                    {r.title && <span className="block text-xs text-neutral-500">{r.title}</span>}
                  </td>
                  <td className="px-4 py-3">{r.calendarEmail}</td>
                  <td className="px-4 py-3">
                    <AccessToggle recruiterId={r.id} field="active" value={r.active} disabled={r.id === ownId} />
                  </td>
                  <td className="px-4 py-3">
                    <AccessToggle recruiterId={r.id} field="isAdmin" value={r.isAdmin} disabled={r.id === ownId} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.active && (
                      <div className="flex justify-end gap-4 whitespace-nowrap">
                        <form action={workAs.bind(null, r.id, "/r")}>
                          <button type="submit" className={BUTTON}>
                            {r.id === ownId ? "My interviews" : "Interviews"}
                          </button>
                        </form>
                        <form action={workAs.bind(null, r.id, "/r/interviews/new")}>
                          <button type="submit" className={BUTTON}>
                            New interview
                          </button>
                        </form>
                        <form action={workAs.bind(null, r.id, "/r/profile")}>
                          <button type="submit" className={BUTTON}>
                            Edit profile
                          </button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Add a recruiter</h2>
        <AddRecruiterForm />
      </section>
    </main>
  );
}
