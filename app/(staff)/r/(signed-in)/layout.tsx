import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/staff/auth";

// COScomms-style header: just the sections, bold, since COSHub already shows
// the ConnectOS branding around this frame.
const NAV_LINK = "text-sm font-semibold text-neutral-800 hover:text-neutral-950";

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaff();
  if (!staff) redirect("/r/login");

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-4">
          <nav className="flex items-center gap-6">
            <Link href="/r" className={NAV_LINK}>
              Interviews
            </Link>
            <Link href="/r/interviews/new" className={NAV_LINK}>
              New interview
            </Link>
            <Link href="/r/profile" className={NAV_LINK}>
              My profile
            </Link>
          </nav>
          <div className="flex items-center gap-4">
            <span className="text-sm text-neutral-500">{staff.email}</span>
            <form action="/r/auth/signout" method="post">
              <button type="submit" className="text-sm font-medium text-neutral-700 hover:text-neutral-950">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      {staff.recruiter ? (
        children
      ) : (
        <main className="mx-auto max-w-6xl px-6 py-8">
          <div className="rounded-lg border border-neutral-200 bg-white p-6">
            <h1 className="text-lg font-semibold text-neutral-900">No recruiter profile yet</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Interviews are linked to recruiter profiles by Outlook calendar email. Ask an admin to add a recruiter
              profile for {staff.email}.
            </p>
          </div>
        </main>
      )}
    </div>
  );
}
