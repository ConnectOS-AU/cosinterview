"use client";

import type { DailyCall } from "@daily-co/daily-js";
import { useEffect, useRef, useState } from "react";
import { BrandLogo } from "@/app/brand-logo";
import { followAdmission } from "@/lib/daily-lobby";
import { useSecondScreen } from "@/lib/companion";
import type { PublicRecruiter } from "@/lib/types";
import { RecruiterAvatar } from "../../c/portal-shell";
import { CLIENT_ADVICE, type ClientAdvice } from "@/lib/stages";
import { getGuestRoomAccess, removeGuestNote, saveGuestAdvice, saveGuestNote, type GuestNote } from "./actions";
import { CandidateDocs, guestScreenKey } from "./candidate-docs";

type Phase = "checking" | "too_early" | "not_booked" | "connecting" | "lobby" | "in_call" | "left" | "denied" | "closed" | "finished" | "no_video" | "error";

type Props = {
  token: string;
  guestName: string;
  recruiter: PublicRecruiter;
  candidateName: string;
  jobTitle: string | null;
  stage: string;
  notePrefix: string;
  startsAt: string | null;
  endsAt: string | null;
  opensAt: string | null;
  finished: boolean;
  jobHtml: string | null;
  initialNotes: GuestNote[];
  canAdvise: boolean;
  initialAdvice: ClientAdvice | null;
};

// A client attendee's lobby. The video call joins without a meeting token, so
// Daily holds them in the lobby until the recruiter admits them; meanwhile (and
// during the call) the resume, job description and their notes are beside it.
export function GuestRoom(props: Props) {
  const { token, guestName, recruiter, candidateName, jobTitle, stage, notePrefix, startsAt, endsAt, opensAt, finished, jobHtml, initialNotes, canAdvise, initialAdvice } = props;
  const screen = useSecondScreen(guestScreenKey(token), `/g/${token}/second-screen`);
  const [zone, setZone] = useState("UTC");

  useEffect(() => {
    // The visitor's own time zone, known only in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);

  const when = startsAt && endsAt ? formatWhen(startsAt, endsAt, zone) : "Time to be confirmed";

  return (
    <div className="min-h-dvh bg-brand-bg">
      <div className="px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <BrandLogo className="-ml-3 h-10 w-auto" />
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wider text-brand-faint">{stage}</p>
            <p className="text-base font-medium text-brand-ink">
              {candidateName}
              {jobTitle && <span className="font-normal text-brand-muted"> · {jobTitle}</span>}
            </p>
            <p className="text-sm text-brand-muted">{when}</p>
          </div>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="min-w-0 space-y-5">
            <VideoArea token={token} guestName={guestName} recruiter={recruiter} opensAt={opensAt} finished={finished} zone={zone} />
            {canAdvise && <AdvicePanel token={token} candidateName={candidateName} recruiterName={recruiter.firstName} initialAdvice={initialAdvice} />}
            <NotesPanel token={token} guestName={guestName} notePrefix={notePrefix} initialNotes={initialNotes} finished={finished} />
          </div>
          <div className="space-y-3">
            {screen.popped ? (
              <section className="space-y-3 rounded-2xl border border-dashed border-brand-line bg-brand-surface px-5 py-6 text-sm text-brand-muted">
                <p>The resume and job description are open in their own window, on your second screen.</p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={screen.focus} className="rounded-lg border border-brand-line px-3 py-1.5 text-xs font-medium text-brand-ink hover:bg-brand-teal-tint">
                    Show that window
                  </button>
                  <button type="button" onClick={screen.bringBack} className="text-xs font-medium text-brand-teal underline">
                    Bring them back here
                  </button>
                </div>
              </section>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {screen.error && <span className="text-xs text-red-600">{screen.error}</span>}
                  <a
                    href={`/g/${token}/job`}
                    target="_blank"
                    rel="noopener"
                    className="rounded-lg border border-brand-line bg-brand-surface px-3 py-1.5 text-xs font-medium text-brand-ink hover:bg-brand-teal-tint"
                  >
                    Job description ↗
                  </a>
                  <button
                    type="button"
                    onClick={screen.open}
                    className="rounded-lg border border-brand-line bg-brand-surface px-3 py-1.5 text-xs font-medium text-brand-ink hover:bg-brand-teal-tint"
                    title="Open the resume and job description in their own window, to put on a second monitor"
                  >
                    Move to second screen ⧉
                  </button>
                </div>
                <CandidateDocs token={token} candidateName={candidateName} jobTitle={jobTitle} jobHtml={jobHtml} height="h-[34rem] lg:h-[calc(100dvh-9rem)]" resumeOnly />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatWhen(start: string, end: string, zone: string): string {
  const day = new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: zone }).format(new Date(start));
  const time = (iso: string) => new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(iso)).toLowerCase();
  return `${day}, ${time(start)} – ${time(end)}`;
}

function VideoArea({
  token,
  guestName,
  recruiter,
  opensAt,
  finished,
  zone,
}: {
  token: string;
  guestName: string;
  recruiter: PublicRecruiter;
  opensAt: string | null;
  finished: boolean;
  zone: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(finished ? "finished" : "checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (finished) return;
    let cancelled = false;
    let call: DailyCall | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function start() {
      const access = await getGuestRoomAccess(token);
      if (cancelled) return;
      if (!access.ok) {
        if (access.reason === "too_early" || access.reason === "not_booked") {
          setPhase(access.reason);
          // Try again when the room opens (checking at least once a minute).
          const wait = opensAt ? Math.min(Math.max(new Date(opensAt).getTime() - Date.now(), 5_000), 60_000) : 60_000;
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
      followAdmission(call, setPhase);

      await call.join({ url: access.roomUrl, userName: access.userName, userData: { role: "client", bookingId: access.bookingId } });
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
  }, [token, opensAt, finished, attempt]);

  const first = guestName.split(/[\s@]/)[0];
  const opens = opensAt ? new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", timeZone: zone }).format(new Date(opensAt)).toLowerCase() : null;
  const copy: Record<Phase, { title: string; body: string; waiting?: boolean; again?: boolean }> = {
    checking: { title: "Getting your room ready", body: "Just a moment…", waiting: true },
    too_early: {
      title: `Welcome ${first}`,
      body: `The video call opens${opens ? ` at ${opens}` : " shortly before the interview"} and this page will connect you automatically. Have a read of the resume and job description in the meantime.`,
      waiting: true,
    },
    not_booked: { title: `Welcome ${first}`, body: "The interview time hasn't been confirmed yet. This page will connect you once it opens.", waiting: true },
    connecting: { title: "Connecting…", body: "If your browser asks to use your camera and microphone, please choose Allow.", waiting: true },
    lobby: {
      title: "You're in the waiting room",
      body: `Allow your camera and microphone if your browser asks, then press Request to join in the box below. ${recruiter.firstName} will bring you in. Your notes and the documents stay available.`,
      waiting: true,
    },
    in_call: { title: "", body: "" },
    left: { title: "You've left the call", body: "You can rejoin while the interview is running.", again: true },
    denied: { title: "You weren't brought in", body: `${recruiter.firstName} may still be with the candidate. Try again in a moment, or reply to your invitation email.`, again: true },
    closed: { title: "The video call has closed", body: "You can still read the documents and add notes here." },
    finished: { title: "This interview has finished", body: "You can still read the documents and add notes - they go to the recruiter." },
    no_video: { title: "You're in the waiting room", body: "Video isn't set up in this environment (no Daily API key), so this is a preview of the waiting screen.", waiting: true },
    error: { title: "We couldn't connect you", body: "Please try again. If it keeps happening, reply to your invitation email.", again: true },
  };
  const inCall = phase === "in_call";
  const knocking = phase === "connecting" || phase === "lobby";
  const { title, body, waiting, again } = copy[phase];

  function tryAgain() {
    setPhase("checking");
    setAttempt((n) => n + 1);
  }

  return (
    <div className="space-y-3">
      {knocking && (
        <div role="status" aria-live="polite">
          <h1 className="text-lg font-medium text-brand-ink">{title}</h1>
          <p className="mt-1 text-sm text-brand-muted">{body}</p>
        </div>
      )}
      {/* As wide as the column allows, but never taller than the window. */}
      <section className="relative aspect-video max-h-[calc(100dvh-6rem)] min-h-[20rem] w-full overflow-hidden rounded-2xl border border-brand-line bg-brand-surface shadow-card">
      {/* The attendee needs Daily's screen to allow their camera and ask to join. */}
      <div ref={frameRef} className={inCall || knocking ? "absolute inset-0 bg-black" : "hidden"} />
      {!inCall && !knocking && (
        <div className="absolute inset-0 flex flex-col justify-center gap-4 overflow-auto p-6 sm:p-10">
          <div className="flex items-center gap-4">
            <RecruiterAvatar recruiter={recruiter} />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-brand-faint">Hosted by</p>
              <p className="truncate text-lg font-medium text-brand-ink">{recruiter.displayName}</p>
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
            <p className="mt-2 max-w-xl text-base text-brand-muted">{body}</p>
          </div>
          {again && (
            <button
              type="button"
              onClick={tryAgain}
              className="w-fit rounded-xl bg-brand-teal px-5 py-2.5 text-sm font-medium text-brand-on-teal shadow-card transition hover:bg-brand-teal-dark"
            >
              {phase === "left" ? "Rejoin" : "Try again"}
            </button>
          )}
        </div>
      )}
      </section>
    </div>
  );
}

function AdvicePanel({
  token,
  candidateName,
  recruiterName,
  initialAdvice,
}: {
  token: string;
  candidateName: string;
  recruiterName: string;
  initialAdvice: ClientAdvice | null;
}) {
  const [advice, setAdvice] = useState(initialAdvice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(key: ClientAdvice) {
    if (busy || key === advice) return;
    setBusy(true);
    setError(null);
    try {
      await saveGuestAdvice(token, key);
      setAdvice(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your advice wasn't saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-brand-line bg-brand-surface p-5 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium text-brand-ink">Your advice on {candidateName}</h2>
        <p className="text-xs text-brand-faint">Shared with the recruiter only</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {CLIENT_ADVICE.map((option) => (
          <button
            key={option.key}
            type="button"
            disabled={busy}
            aria-pressed={advice === option.key}
            onClick={() => choose(option.key)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-60 ${
              advice === option.key ? "border-brand-ink bg-brand-ink text-white" : "border-brand-line text-brand-ink hover:bg-brand-mist"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="mt-2 text-sm text-red-700">{error}</p>
      ) : (
        <p className="mt-2 text-xs text-brand-muted">
          {advice ? `Saved. ${recruiterName} will see this. You can change it at any time.` : `Choose one when you're ready. ${recruiterName} will see it.`}
        </p>
      )}
    </section>
  );
}

function NotesPanel({
  token,
  guestName,
  notePrefix,
  initialNotes,
  finished,
}: {
  token: string;
  guestName: string;
  notePrefix: string;
  initialNotes: GuestNote[];
  finished: boolean;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [notes.length]);

  async function add() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const note = await saveGuestNote(token, text);
      setNotes((n) => [...n, note]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your note wasn't saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await removeGuestNote(token, id);
      setNotes((n) => n.filter((x) => x.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove the note.");
    }
  }

  return (
    <section className="rounded-2xl border border-brand-line bg-brand-surface p-5 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-medium text-brand-ink">Your notes</h2>
        <p className="text-xs text-brand-faint">Shared with the recruiter only</p>
      </div>
      {notes.length > 0 && (
        <ol ref={listRef} className="mt-3 max-h-72 space-y-2 overflow-auto">
          {notes.map((n) => (
            <li key={n.id} className="group rounded-lg bg-brand-bg px-3 py-2 text-sm text-brand-text">
              <p className="text-xs text-brand-faint">
                {notePrefix} {guestName} · {new Date(n.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap">{n.body}</p>
              {!finished && (
                <button
                  type="button"
                  onClick={() => remove(n.id)}
                  className="mt-1 text-xs text-brand-faint underline opacity-0 transition focus:opacity-100 group-hover:opacity-100"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void add();
        }}
        rows={3}
        maxLength={5000}
        placeholder="Type a note… (Ctrl+Enter to save)"
        className="mt-3 w-full rounded-lg border border-brand-line bg-brand-bg px-3 py-2 text-sm text-brand-text placeholder:text-brand-faint focus:border-brand-teal focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-brand-faint">
          Saved as “{notePrefix} {guestName}: …”
        </p>
        <button
          type="button"
          onClick={add}
          disabled={busy || !draft.trim()}
          className="rounded-lg bg-brand-teal px-4 py-1.5 text-sm font-medium text-brand-on-teal transition hover:bg-brand-teal-dark disabled:opacity-40"
        >
          {busy ? "Saving…" : "Add note"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
