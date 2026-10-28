import Link from "next/link";
import { demoMode } from "@/lib/demo";
import { recruiterPhotoUrl } from "@/lib/invite";
import { requireRecruiter } from "@/lib/staff/auth";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { recruiter, actingAs } = await requireRecruiter();
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">{actingAs ? `${recruiter.displayName}’s profile` : "My profile"}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Candidates see this when they open {actingAs ? "their" : "your"} invite link. The link name is <code>/c/{recruiter.slug}/…</code>
          {demoMode() && (
            <>
              {" "}
              - preview it at{" "}
              <Link href="/c/demo/demo" target="_blank" className="underline">
                the demo invite
              </Link>
            </>
          )}
          .
        </p>
      </div>
      <ProfileForm
        profile={{
          displayName: recruiter.displayName,
          title: recruiter.title ?? "",
          bio: recruiter.bio ?? "",
          welcomeMessage: recruiter.welcomeMessage ?? "",
          timezone: recruiter.timezone,
          photoUrl: recruiterPhotoUrl(recruiter.photoPath),
          calendarEmail: recruiter.calendarEmail,
        }}
      />
    </main>
  );
}
