"use client";

import type { DailyCall } from "@daily-co/daily-js";
import { useEffect, useRef, useState } from "react";
import { waitingRoomContent } from "@/content/waiting-room";
import { formatDay, formatTime, formatZone } from "@/lib/format";
import type { PublicRecruiter } from "@/lib/types";
import { BrandLogo } from "../../../../brand-logo";
import { RecruiterAvatar } from "../../../portal-shell";
import { getRoomAccess } from "../actions";

type Phase =
  | "checking"
  | "too_early"
  | "connecting"
  | "lobby"
  | "in_call"
  | "left"
  | "denied"
  | "closed"
  | "no_video"
  | "error";

type Props = {
  recruiterSlug: string;
  token: string;
  recruiter: PublicRecruiter;
  candidateFirstName: string;
  startsAt: string;
  opensAt: string;
  zone: string;
};

// The candidate's side of the interview. They join the Daily room without a
// meeting token, so Daily holds them in the lobby; we keep the video hidden and
// show the ConnectOS waiting screen until the recruiter lets them in.
export function InterviewRoom(props: Props) {
  const { recruiterSlug, token, recruiter, candidateFirstName, startsAt, opensAt, zone } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("checking");

  useEffect(() => {
    let cancelled = false;
    let call: DailyCall | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function start() {
      const access = await getRoomAccess(recruiterSlug, token);
      if (cancelled) return;
      if (!access.ok) {
        if (access.reason === "too_early") {
          setPhase("too_early");
          // Try again when the room opens (checking at least once a minute).
          const wait = Math.min(Math.max(new Date(opensAt).getTime() - Date.now(), 5_000), 60_000);
          retry = setTimeout(start, wait);
        } else {
          setPhase(access.reason === "closed" ? "closed" : "error");
        }
        return;
      }
      if (!access.roomUrl) {
        setPhase("no_video");
        return;
      }

      setPhase("connecting");
      const Daily = (await import("@daily-co/daily-js")).default;
      if (cancelled || !frameRef.current) return;
      await Daily.getCallInstance()?.destroy();
      call = Daily.createFrame(frameRef.current, {
        iframeStyle: { width: "100%", height: "100%", border: "0" },
        showLeaveButton: true,
        showFullscreenButton: true,
      });
      call.on("left-meeting", () => setPhase((p) => (p === "denied" ? p : "left")));
      call.on("error", () => setPhase((p) => (p === "denied" ? p : "error")));

      await call.join({
        url: access.roomUrl,
        userName: access.candidateName,
        userData: { role: "candidate", bookingId: access.bookingId },
      });
      if (cancelled) return;

      const { access: level } = call.accessState();
      if (level !== "unknown" && level.level === "lobby") {
        setPhase("lobby");
        const { granted } = await call.requestAccess({ name: access.candidateName, access: { level: "full" } });
        if (!cancelled) setPhase(granted ? "in_call" : "denied");
      } else {
        setPhase("in_call");
      }
    }

    start().catch((err) => {
      console.error(err);
      if (!cancelled) setPhase("error");
    });
    return () => {
      cancelled = true;
      clearTimeout(retry);
      void call?.destroy();
    };
  }, [recruiterSlug, token, opensAt]);

  const inCall = phase === "in_call";

  return (
    <div className="min-h-dvh bg-brand-bg">
      {/* The Daily frame stays mounted (so camera/mic permission and the lobby
          connection carry on) but is only shown once the candidate is admitted. */}
      <div
        ref={frameRef}
        className={inCall ? "fixed inset-0 z-20 bg-black" : "pointer-events-none fixed inset-0 -z-10 opacity-0"}
        aria-hidden={!inCall}
      />
      {!inCall && (
        <div className="mx-auto max-w-6xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 sm:px-6 lg:pt-10">
          <header className="flex items-center justify-between">
            <BrandLogo className="-ml-3 h-11 w-auto" />
            <p className="hidden text-sm text-brand-faint sm:block">Where offshoring meets excellence</p>
          </header>
          <div className="mt-6 grid gap-6 lg:mt-10 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <StatusCard
                phase={phase}
                recruiter={recruiter}
                candidateFirstName={candidateFirstName}
                startsAt={startsAt}
                opensAt={opensAt}
                zone={zone}
                inviteHref={`/c/${recruiterSlug}/${token}`}
              />
            </div>
            <div className="lg:col-span-3">
              <MarketingPanel />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusCard({
  phase,
  recruiter,
  candidateFirstName,
  startsAt,
  opensAt,
  zone,
  inviteHref,
}: {
  phase: Phase;
  recruiter: PublicRecruiter;
  candidateFirstName: string;
  startsAt: string;
  opensAt: string;
  zone: string;
  inviteHref: string;
}) {
  const when = `${formatDay(startsAt, zone)} at ${formatTime(startsAt, zone)} (${formatZone(zone)} time)`;
  const copy: Record<Phase, { title: string; body: string; waiting?: boolean }> = {
    checking: { title: "Getting your room ready", body: "Just a moment…", waiting: true },
    too_early: {
      title: `Hi ${candidateFirstName}, you're early`,
      body: `Your interview is on ${when}. The room opens at ${formatTime(opensAt, zone)} and this page will let you in automatically.`,
      waiting: true,
    },
    connecting: {
      title: "Connecting…",
      body: "If your browser asks to use your camera and microphone, please choose Allow.",
      waiting: true,
    },
    lobby: {
      title: `Thanks ${candidateFirstName}, you're in the waiting room`,
      body: `${recruiter.firstName} has been told you're here and will let you in shortly. Please keep this page open.`,
      waiting: true,
    },
    in_call: { title: "", body: "" },
    left: {
      title: "Thanks for your time",
      body: `You've left the interview. ${recruiter.firstName} will be in touch about the next steps.`,
    },
    denied: {
      title: "You weren't admitted",
      body: "If you think this is a mistake, please reply to your invitation email.",
    },
    closed: {
      title: "This interview room has closed",
      body: "If you missed your interview, please reply to your invitation email to rearrange.",
    },
    no_video: {
      title: `Thanks ${candidateFirstName}, you're in the waiting room`,
      body: "Video isn't set up in this environment (no Daily API key), so this is a preview of the waiting screen.",
      waiting: true,
    },
    error: {
      title: "We couldn't connect you",
      body: "Please refresh the page to try again. If it keeps happening, reply to your invitation email.",
    },
  };
  const { title, body, waiting } = copy[phase];

  return (
    <div className="space-y-5 rounded-3xl border border-brand-line bg-brand-surface p-6 shadow-xl shadow-brand-gold/10 animate-fade-up sm:p-8">
      <div className="flex items-center gap-4">
        <RecruiterAvatar recruiter={recruiter} />
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-brand-faint">Interview with</p>
          <p className="truncate text-lg font-medium text-brand-ink">{recruiter.displayName}</p>
          {recruiter.title && <p className="truncate text-sm text-brand-muted">{recruiter.title}</p>}
        </div>
      </div>
      <div role="status" aria-live="polite">
        <div className="flex items-center gap-2">
          {waiting && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-teal opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-teal" />
            </span>
          )}
          <h1 className="text-xl font-medium text-brand-ink sm:text-2xl">{title}</h1>
        </div>
        <p className="mt-2 text-base text-brand-muted">{body}</p>
      </div>
      {phase === "error" && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex w-full items-center justify-center rounded-xl bg-brand-teal px-4 py-3 text-base font-medium text-brand-on-teal shadow-card transition hover:bg-brand-teal-dark"
        >
          Try again
        </button>
      )}
      {waiting && (
        <ul className="space-y-2 border-t border-brand-line pt-4 text-sm text-brand-text">
          {waitingRoomContent.tips.map((tip) => (
            <li key={tip} className="flex gap-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-gold" />
              {tip}
            </li>
          ))}
        </ul>
      )}
      {(phase === "denied" || phase === "closed") && (
        <a href={inviteHref} className="text-sm text-brand-teal underline">
          Back to your booking
        </a>
      )}
    </div>
  );
}

function MarketingPanel() {
  const c = waitingRoomContent;
  return (
    <section className="overflow-hidden rounded-3xl border border-brand-line bg-brand-surface shadow-card animate-fade-up">
      <div className="relative h-40 sm:h-52">
        {/* eslint-disable-next-line @next/next/no-img-element -- static asset in public/ */}
        <img src="/login-photo.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0C4E60]/90 via-[#0C4E60]/40 to-[#0C4E60]/10" />
        <h2 className="absolute inset-x-0 bottom-0 p-6 text-2xl font-semibold text-white sm:text-3xl">{c.headline}</h2>
      </div>
      <div className="space-y-6 p-6 sm:p-8">
        <p className="text-base text-brand-text">{c.intro}</p>
        {c.videoUrl && (
          <div className="aspect-video overflow-hidden rounded-2xl bg-brand-sunken">
            <iframe
              src={c.videoUrl}
              title="About ConnectOS"
              className="h-full w-full"
              allow="encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {c.highlights.map((h) => (
            <div key={h.title} className="rounded-2xl border border-brand-line bg-brand-sunken p-4">
              <p className="font-medium text-brand-ink">{h.title}</p>
              <p className="mt-1 text-sm text-brand-muted">{h.body}</p>
            </div>
          ))}
        </div>
        {c.cta && (
          <a
            href={c.cta.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-xl border border-brand-gold/50 bg-brand-gold-tint px-4 py-2.5 text-sm font-medium text-brand-gold-dark transition hover:bg-brand-gold/20"
          >
            {c.cta.label}
          </a>
        )}
      </div>
    </section>
  );
}
