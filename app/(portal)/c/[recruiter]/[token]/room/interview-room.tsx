"use client";

import type { DailyCall } from "@daily-co/daily-js";
import { useEffect, useRef, useState } from "react";
import type { AdmissionState } from "@/lib/daily-lobby";
import type { WaitingRoomContent } from "@/content/waiting-room";
import { followAdmission } from "@/lib/daily-lobby";
import { formatDay, formatTime, formatZone } from "@/lib/format";
import { followBackground, joinBackground } from "@/lib/lobby-background";
import type { PublicRecruiter } from "@/lib/types";
import { BrandLogo } from "@/app/brand-logo";
import { BackgroundPicker } from "../../../../background-picker";
import { InterviewTipsPanel, LobbyPanel, LobbyTips } from "../../../../lobby-panel";
import { RecruiterAvatar } from "../../../portal-shell";
import { getRoomAccess, type RoomAccess } from "../actions";

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
  lobby: WaitingRoomContent;
  // The JobAdder job description page, when there is one.
  jobHref: string | null;
};

// The candidate's side of the interview. They join the Daily room without a
// meeting token, so Daily holds them in the lobby. Daily's own screen (camera
// and microphone, Request to join) shows above the ConnectOS waiting content
// until the recruiter lets them in, then the video fills the page. The app can't
// admit anyone inside Daily's frame, so if the recruiter chooses to start early the
// page joins again with the token it's given, which skips the lobby.
export function InterviewRoom(props: Props) {
  const { recruiterSlug, token, recruiter, candidateFirstName, startsAt, opensAt, zone, lobby, jobHref } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("checking");
  const [backgroundFailed, setBackgroundFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let call: DailyCall | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let watch: ReturnType<typeof setInterval> | undefined;
    let admission: AdmissionState | null = null;
    let rejoining = false;

    async function enter(access: Extract<RoomAccess, { ok: true }>) {
      setPhase("connecting");
      const Daily = (await import("@daily-co/daily-js")).default;
      if (cancelled || !frameRef.current) return;
      await Daily.getCallInstance()?.destroy();
      call = Daily.createFrame(frameRef.current, {
        iframeStyle: { width: "100%", height: "100%", border: "0" },
        showLeaveButton: true,
        showFullscreenButton: true,
      });
      call.on("left-meeting", () => {
        if (!rejoining) setPhase((p) => (p === "denied" ? p : "left"));
      });
      followAdmission(call, (state) => {
        admission = state;
        setPhase(state);
      });
      followBackground(call, () => setBackgroundFailed(true));

      await call.join({
        url: access.roomUrl!,
        ...(access.token ? { token: access.token } : {}),
        ...joinBackground(Daily),
        userName: access.candidateName,
        userData: { role: "candidate", bookingId: access.bookingId },
      });
    }

    // In the lobby: come straight in if the recruiter chooses to start early.
    async function checkForEarlyStart() {
      if (admission !== "lobby") return;
      const access = await getRoomAccess(recruiterSlug, token);
      if (cancelled || admission !== "lobby" || !access.ok || !access.token) return;
      clearInterval(watch);
      rejoining = true;
      await call?.destroy();
      rejoining = false;
      await enter(access);
    }

    async function start() {
      const access = await getRoomAccess(recruiterSlug, token);
      if (cancelled) return;
      if (!access.ok) {
        if (access.reason === "too_early") {
          setPhase("too_early");
          // Keep checking: the recruiter may choose to start early.
          const wait = Math.min(Math.max(new Date(opensAt).getTime() - Date.now(), 5_000), 10_000);
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

      watch = setInterval(() => void checkForEarlyStart().catch(fail), 10_000);
      await enter(access);
    }

    function fail(err: unknown) {
      console.error(err);
      if (!cancelled) setPhase("error");
    }

    start().catch(fail);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      clearInterval(watch);
      void call?.destroy();
    };
  }, [recruiterSlug, token, opensAt]);

  const inCall = phase === "in_call";
  const knocking = phase === "connecting" || phase === "lobby";

  return (
    <div className="min-h-dvh bg-brand-bg">
      {!inCall && (
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 pt-6 sm:px-6 lg:pt-10">
          <BrandLogo className="-ml-3 h-11 w-auto" />
          <p className="hidden text-sm text-brand-faint sm:block">Where offshoring meets excellence</p>
        </header>
      )}
      {/* One element throughout, so the call isn't interrupted by moving it. The
          candidate needs Daily's screen to allow their camera and ask to join. */}
      <div
        ref={frameRef}
        className={
          inCall
            ? "fixed inset-0 z-20 bg-black"
            : knocking
              ? "mx-auto mt-6 h-[26rem] w-[calc(100%-2rem)] max-w-[70rem] overflow-hidden rounded-3xl border border-brand-line bg-brand-surface lg:h-[20rem]"
              : "hidden"
        }
      />
      {!inCall && (
        <div className="mx-auto max-w-6xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
          {/* Beside the camera preview it changes. */}
          {(knocking || phase === "too_early") && (
            <div className="mt-6">
              <BackgroundPicker failed={backgroundFailed} />
            </div>
          )}
          <div className="mt-6 grid gap-6 lg:grid-cols-5">
            <div className="space-y-6 lg:col-span-2">
              <StatusCard
                phase={phase}
                recruiter={recruiter}
                candidateFirstName={candidateFirstName}
                startsAt={startsAt}
                opensAt={opensAt}
                zone={zone}
                inviteHref={`/c/${recruiterSlug}/${token}`}
                tipsHtml={lobby.tipsHtml}
                job={jobHref ? { href: jobHref, label: lobby.jobLinkLabel } : null}
              />
              <InterviewTipsPanel title={lobby.interviewTipsTitle} html={lobby.interviewTipsHtml} />
            </div>
            <div className="lg:col-span-3">
              <LobbyPanel content={lobby} />
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
  tipsHtml,
  job,
}: {
  phase: Phase;
  recruiter: PublicRecruiter;
  candidateFirstName: string;
  startsAt: string;
  opensAt: string;
  zone: string;
  inviteHref: string;
  tipsHtml: string;
  job: { href: string; label: string } | null;
}) {
  const when = `${formatDay(startsAt, zone)} at ${formatTime(startsAt, zone)} (${formatZone(zone)} time)`;
  const copy: Record<Phase, { title: string; body: string; waiting?: boolean }> = {
    checking: { title: "Getting your room ready", body: "Just a moment…", waiting: true },
    too_early: {
      title: `Hi ${candidateFirstName}, you're early`,
      body: `Your interview is on ${when}. The room opens at ${formatTime(opensAt, zone)} and this page will let you in automatically, or sooner if ${recruiter.firstName} starts early.`,
      waiting: true,
    },
    connecting: {
      title: "Connecting…",
      body: "If your browser asks to use your camera and microphone, please choose Allow.",
      waiting: true,
    },
    lobby: {
      title: `Thanks ${candidateFirstName}, you're in the waiting room`,
      body: `Allow your camera and microphone if your browser asks, then press Request to join in the box above. ${recruiter.firstName} will let you in shortly. Please keep this page open.`,
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
      {job && phase !== "left" && (
        // A new tab, so the candidate keeps their place in the waiting room.
        <a
          href={job.href}
          target="_blank"
          rel="noopener"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-teal/40 bg-brand-teal-tint px-4 py-2.5 text-sm font-medium text-brand-teal transition hover:bg-brand-teal/10"
        >
          {job.label}
          <span aria-hidden>↗</span>
        </a>
      )}
      {waiting && <LobbyTips html={tipsHtml} />}
      {(phase === "denied" || phase === "closed") && (
        <a href={inviteHref} className="text-sm text-brand-teal underline">
          Back to your booking
        </a>
      )}
    </div>
  );
}

