import Link from "next/link";
import { redirect } from "next/navigation";
import { isDemoInvite, resetDemoInvite } from "@/lib/demo";
import { formatDay, formatTime, formatZone } from "@/lib/format";
import { availableSlots, inviteExpired, invitePath, loadInvite, publicRecruiter } from "@/lib/invite";
import type { InviteRecord, PublicRecruiter } from "@/lib/types";
import { Notice, PortalShell, RecruiterAvatar } from "../../portal-shell";
import { SlotPicker } from "./slot-picker";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ recruiter: string; token: string }>;
  searchParams: Promise<{ reset?: string }>;
};

export default async function InvitePage({ params, searchParams }: Props) {
  const { recruiter: slug, token } = await params;
  if ((await searchParams).reset && isDemoInvite(slug, token)) {
    resetDemoInvite();
    redirect(`/c/${slug}/${token}`);
  }

  const invite = await loadInvite(slug, token);
  if (!invite) {
    return (
      <PortalShell>
        <Notice title="This link isn't valid">
          <p>Please check you&apos;ve used the full link from your invitation email, or contact your ConnectOS recruiter.</p>
        </Notice>
      </PortalShell>
    );
  }

  const recruiter = publicRecruiter(invite);
  return (
    <PortalShell recruiter={recruiter}>
      <InviteBody invite={invite} recruiter={recruiter} token={token} />
    </PortalShell>
  );
}

async function InviteBody({ invite, recruiter, token }: { invite: InviteRecord; recruiter: PublicRecruiter; token: string }) {
  switch (invite.status) {
    case "booked":
    case "in_progress":
      return <Booked invite={invite} token={token} />;
    case "completed":
    case "no_show":
      return (
        <Notice title="This interview has finished">
          <p>Thanks for your time. {recruiter.firstName} will be in touch about the next steps.</p>
        </Notice>
      );
    case "cancelled":
      return (
        <Notice title="This interview was cancelled">
          <p>If you think this is a mistake, please reply to your invitation email.</p>
        </Notice>
      );
  }

  if (inviteExpired(invite) || invite.interview.status !== "open") {
    return (
      <Notice title="This invite has expired">
        <p>Please reply to your invitation email and {recruiter.firstName} can send you a new link.</p>
      </Notice>
    );
  }

  const slots = await availableSlots(invite);
  return (
    <>
      <Welcome invite={invite} recruiter={recruiter} />
      <SlotPicker
        recruiterSlug={invite.recruiter.slug}
        token={token}
        slots={slots}
        durationMins={invite.interview.durationMins}
        recruiterFirstName={recruiter.firstName}
      />
    </>
  );
}

function Welcome({ invite, recruiter }: { invite: InviteRecord; recruiter: PublicRecruiter }) {
  const firstName = invite.candidateName.split(" ")[0];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-medium text-brand-ink sm:text-3xl">Hi {firstName}, let&apos;s find a time</h1>
        {invite.interview.jobTitle && (
          <p className="mt-1 text-base text-brand-muted">
            {invite.interview.durationMins}-minute video interview for{" "}
            <span className="font-medium text-brand-text">{invite.interview.jobTitle}</span>
          </p>
        )}
      </div>
      <div className="flex gap-4 rounded-2xl border border-brand-line bg-brand-sunken p-4">
        <RecruiterAvatar recruiter={recruiter} />
        <div className="min-w-0 space-y-1.5">
          <p className="font-medium text-brand-ink">
            {recruiter.displayName}
            {recruiter.title && <span className="font-normal text-brand-muted"> &middot; {recruiter.title}</span>}
          </p>
          {recruiter.welcomeMessage && <p className="text-sm text-brand-text">{recruiter.welcomeMessage}</p>}
          {recruiter.bio && <p className="text-sm text-brand-muted">{recruiter.bio}</p>}
        </div>
      </div>
    </div>
  );
}

function Booked({ invite, token }: { invite: InviteRecord; token: string }) {
  const zone = invite.candidateTimezone ?? invite.recruiter.timezone;
  const base = invitePath(invite, token);
  return (
    <div className="space-y-6">
      <Notice title="You're booked in">
        <p>
          {invite.graphEventId
            ? `We've sent a calendar invitation to ${invite.candidateEmail}.`
            : "Add it to your calendar so you don't miss it."}
        </p>
      </Notice>
      {invite.slotStart && invite.slotEnd && (
        <div className="rounded-2xl border border-brand-teal/20 bg-brand-teal-tint p-5">
          <p className="text-lg font-medium text-brand-ink">{formatDay(invite.slotStart, zone)}</p>
          <p className="text-brand-text">
            {formatTime(invite.slotStart, zone)} – {formatTime(invite.slotEnd, zone)}{" "}
            <span className="text-brand-muted">({formatZone(zone)} time)</span>
          </p>
          <p className="mt-2 text-sm text-brand-muted">
            Video interview with {invite.recruiter.displayName}
            {invite.interview.jobTitle ? ` for ${invite.interview.jobTitle}` : ""}
          </p>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href={`${base}/room`}
          className="flex flex-1 items-center justify-center rounded-xl bg-brand-teal px-4 py-3 text-base font-medium text-brand-on-teal shadow-card transition hover:bg-brand-teal-dark active:scale-[0.99]"
        >
          Go to interview room
        </Link>
        <a
          href={`${base}/invite.ics`}
          className="flex flex-1 items-center justify-center rounded-xl border border-brand-line-strong bg-brand-surface px-4 py-3 text-base font-medium text-brand-ink transition hover:bg-brand-sunken"
        >
          Add to calendar
        </a>
      </div>
      <ul className="space-y-1.5 text-sm text-brand-muted">
        <li>The room opens 15 minutes before your start time.</li>
        <li>Use a laptop or phone with a camera, in a quiet spot with good internet.</li>
        <li>Need to change the time? Reply to your invitation email.</li>
      </ul>
    </div>
  );
}
