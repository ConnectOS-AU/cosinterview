import type { Metadata } from "next";
import { getJobDescription } from "@/lib/job-description";
import { loadInvite, publicRecruiter } from "@/lib/invite";
import { Notice, PortalShell } from "../../../portal-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Job description · ConnectOS Interviews" };

type Props = { params: Promise<{ recruiter: string; token: string }> };

// The job description from JobAdder, for the candidate holding this invite.
// Opened from the lobby in a new tab, so their place in the waiting room stays.
export default async function JobPage({ params }: Props) {
  const { recruiter: slug, token } = await params;
  const invite = await loadInvite(slug, token);
  if (!invite) {
    return (
      <PortalShell>
        <Notice title="This link isn't valid">
          <p>Please use the link from your invitation email, or contact your ConnectOS recruiter.</p>
        </Notice>
      </PortalShell>
    );
  }

  const description = await getJobDescription(invite.interview.jobadderJobId);
  const recruiter = publicRecruiter(invite);
  return (
    <PortalShell recruiter={recruiter}>
      <article className="space-y-5 rounded-3xl border border-brand-line bg-brand-surface p-6 shadow-card animate-fade-up sm:p-8">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-brand-faint">Job description</p>
          <h1 className="mt-1 text-2xl font-semibold text-brand-ink">{invite.interview.jobTitle ?? "Your interview"}</h1>
        </div>
        {description ? (
          <div className="lobby-html" dangerouslySetInnerHTML={{ __html: description }} />
        ) : (
          <p className="text-base text-brand-muted">
            The job description isn&apos;t available right now. {recruiter.firstName} will be happy to talk you through the role.
          </p>
        )}
      </article>
    </PortalShell>
  );
}
