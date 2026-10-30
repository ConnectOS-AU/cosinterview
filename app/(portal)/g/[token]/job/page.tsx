import type { Metadata } from "next";
import { findGuestByToken } from "@/lib/guests";
import { publicRecruiter } from "@/lib/invite";
import { getJobDescription } from "@/lib/job-description";
import { Notice, PortalShell } from "../../../c/portal-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Job description · ConnectOS Interviews" };

type Props = { params: Promise<{ token: string }> };

// The job description for an attendee, opened in its own tab from their
// interview room so the video there keeps the space.
export default async function GuestJobPage({ params }: Props) {
  const { token } = await params;
  const found = await findGuestByToken(token);
  if (!found) {
    return (
      <PortalShell>
        <Notice title="This link isn't valid">
          <p>Please use the link from your invitation email, or contact your ConnectOS recruiter for a new one.</p>
        </Notice>
      </PortalShell>
    );
  }

  const { invite } = found;
  const recruiter = publicRecruiter(invite);
  const description = await getJobDescription(invite.interview.jobadderJobId);
  return (
    <PortalShell recruiter={recruiter}>
      <article className="space-y-5 rounded-3xl border border-brand-line bg-brand-surface p-6 shadow-card animate-fade-up sm:p-8">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-brand-faint">Job description</p>
          <h1 className="mt-1 text-2xl font-semibold text-brand-ink">{invite.interview.jobTitle ?? "Interview"}</h1>
        </div>
        {description ? (
          <div className="lobby-html" dangerouslySetInnerHTML={{ __html: description }} />
        ) : (
          <p className="text-base text-brand-muted">The job description isn&apos;t available right now.</p>
        )}
      </article>
    </PortalShell>
  );
}
