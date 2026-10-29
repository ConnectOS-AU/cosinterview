"use client";

import type { DailyCall } from "@daily-co/daily-js";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { InterviewNote } from "@/lib/staff/repo";
import { noteLine, parseCallName } from "@/lib/stages";
import { finishInterview, joinAsRecruiter, loadNotes, noteAttendee, recordingStarted, removeNote, saveNote } from "./actions";

type Phase = "idle" | "joining" | "joined" | "left" | "no_video" | "error";
type RecordingState = "off" | "starting" | "on" | "failed";
type Waiting = { id: string; name: string };

type Props = {
  bookingId: string;
  candidateName: string;
  canJoin: boolean;
  initialNotes: InterviewNote[];
  // "[Interview 1 · 30 Oct 2026]", in front of every note.
  notePrefix: string;
  // Right-hand column beside the video (the job description).
  aside?: ReactNode;
};

// The recruiter's side of the interview: Daily video (joined as owner), a banner
// to admit the candidate from the lobby, automatic recording once the candidate
// is in, timestamped notes under the video, and `aside` (the job description)
// to the right.
export function InterviewScreen({ bookingId, candidateName, canJoin, initialNotes, notePrefix, aside }: Props) {
  const router = useRouter();
  const frameRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<DailyCall | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [recording, setRecordingState] = useState<RecordingState>("off");
  const recordingRef = useRef<RecordingState>("off");
  const setRecording = (state: RecordingState) => {
    recordingRef.current = state;
    setRecordingState(state);
  };
  // Note timestamps count from the recording start (so they line up with the
  // transcript), or from when the recruiter joined until recording starts.
  const [clockStart, setClockStart] = useState<number | null>(null);

  useEffect(() => () => void callRef.current?.destroy(), []);

  async function join() {
    setPhase("joining");
    setError(null);
    const result = await joinAsRecruiter(bookingId);
    if (!result.ok) {
      setError(result.error);
      setPhase("error");
      return;
    }
    if (!result.roomUrl) {
      setClockStart(Date.now());
      setPhase("no_video");
      return;
    }

    const Daily = (await import("@daily-co/daily-js")).default;
    await Daily.getCallInstance()?.destroy();
    const call = Daily.createFrame(frameRef.current!, {
      iframeStyle: { width: "100%", height: "100%", border: "0" },
      showLeaveButton: true,
      showFullscreenButton: true,
    });
    callRef.current = call;

    call.on("waiting-participant-added", (e) => {
      if (!e) return;
      setWaiting((w) => [...w.filter((p) => p.id !== e.participant.id), { id: e.participant.id, name: e.participant.name }]);
    });
    call.on("waiting-participant-removed", (e) => {
      if (!e) return;
      setWaiting((w) => w.filter((p) => p.id !== e.participant.id));
    });
    // Start recording once the candidate is in (not when a client attendee is
    // let in early).
    call.on("participant-joined", (e) => {
      if (!e || e.participant.local) return;
      // Attendance: everyone who comes into the call, once each.
      void noteAttendee(bookingId, e.participant.user_name ?? "");
      if (isGuest(e.participant.user_name)) return;
      if (recordingRef.current === "off" || recordingRef.current === "failed") {
        setRecording("starting");
        call.startRecording();
      }
    });
    call.on("recording-started", (e) => {
      setRecording("on");
      setClockStart(Date.now());
      const recordingId = e && "recordingId" in e && typeof e.recordingId === "string" ? e.recordingId : null;
      void recordingStarted(bookingId, recordingId);
    });
    call.on("recording-stopped", () => setRecording("off"));
    call.on("recording-error", () => setRecording("failed"));
    call.on("left-meeting", () => {
      setPhase("left");
      setWaiting([]);
    });

    try {
      await call.join({ url: result.roomUrl, token: result.token });
      setClockStart((c) => c ?? Date.now());
      setPhase("joined");
    } catch (err) {
      console.error(err);
      setError("Couldn't join the video call. Check your camera and microphone permissions and try again.");
      setPhase("error");
    }
  }

  async function admitAll() {
    for (const p of waiting) await callRef.current?.updateWaitingParticipant(p.id, { grantRequestedAccess: true });
    setWaiting([]);
  }

  async function admit(id: string, allow: boolean) {
    await callRef.current?.updateWaitingParticipant(id, { grantRequestedAccess: allow });
    setWaiting((w) => w.filter((p) => p.id !== id));
  }

  async function finish(outcome: "completed" | "no_show") {
    const call = callRef.current;
    if (call) {
      if (recordingRef.current === "on") await call.stopRecording();
      await call.leave();
    }
    await finishInterview(bookingId, outcome);
    router.push("/r");
  }

  const inCall = phase === "joined";

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        {waiting.length > 0 && (
          <section role="alert" className="rounded-lg border border-amber-200 bg-amber-50">
            <div className="flex items-center justify-between gap-3 border-b border-amber-200 px-4 py-2">
              <p className="text-sm font-semibold text-amber-900">In the lobby</p>
              {waiting.length > 1 && (
                <button type="button" onClick={admitAll} className="text-xs font-medium text-amber-900 underline hover:text-amber-950">
                  Admit everyone
                </button>
              )}
            </div>
            <ul className="divide-y divide-amber-200">
              {waiting.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <p className="text-sm text-amber-900">
                    <span className="font-semibold">{parseCallName(p.name).name || candidateName}</span>{" "}
                    <span className="text-xs">{parseCallName(p.name).role ?? "candidate"}</span>
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => admit(p.id, true)}
                      className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
                    >
                      Admit
                    </button>
                    <button
                      type="button"
                      onClick={() => admit(p.id, false)}
                      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                    >
                      Deny
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="relative aspect-video overflow-hidden rounded-lg border border-neutral-200 bg-neutral-900">
          <div ref={frameRef} className={inCall ? "absolute inset-0" : "hidden"} />
          {!inCall && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              {phase === "idle" && (
                <>
                  <p className="text-sm text-neutral-300">
                    {canJoin
                      ? `Join when you're ready. ${candidateName} will wait in the lobby until you admit them.`
                      : "This interview isn't booked, so there's no room to join."}
                  </p>
                  {canJoin && (
                    <button
                      type="button"
                      onClick={join}
                      className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-100"
                    >
                      Join interview
                    </button>
                  )}
                </>
              )}
              {phase === "joining" && <p className="text-sm text-neutral-300">Connecting…</p>}
              {phase === "left" && <p className="text-sm text-neutral-300">You&apos;ve left the call.</p>}
              {phase === "no_video" && (
                <p className="max-w-sm text-sm text-neutral-300">
                  Video isn&apos;t set up in this environment (no Daily API key). Notes still work and are timed from
                  when you pressed Join.
                </p>
              )}
              {phase === "error" && (
                <>
                  <p className="text-sm text-red-300">{error}</p>
                  <button
                    type="button"
                    onClick={join}
                    className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-100"
                  >
                    Try again
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <RecordingPill state={recording} />
          {(inCall || phase === "left" || phase === "no_video") && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => finish("no_show")}
                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
              >
                Mark as no-show
              </button>
              <button
                type="button"
                onClick={() => finish("completed")}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
              >
                End interview
              </button>
            </div>
          )}
        </div>

        <NotesPanel bookingId={bookingId} initialNotes={initialNotes} clockStart={clockStart} prefix={notePrefix} />
      </div>

      {aside && <div className="space-y-5 lg:sticky lg:top-4 lg:self-start">{aside}</div>}
    </div>
  );
}

const isGuest = (name: string | undefined) => parseCallName(name).role !== null;

function RecordingPill({ state }: { state: RecordingState }) {
  if (state === "on") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-600 motion-reduce:animate-none" />
        Recording
      </span>
    );
  }
  if (state === "starting") return <span className="text-xs text-neutral-500">Starting recording…</span>;
  if (state === "failed") {
    return (
      <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
        Recording didn&apos;t start - check the Daily recording setup
      </span>
    );
  }
  return <span className="text-xs text-neutral-500">Recording starts when the candidate joins.</span>;
}

function formatOffset(ms: number | null): string {
  if (ms === null) return "Before";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function NotesPanel({
  bookingId,
  initialNotes,
  clockStart,
  prefix,
}: {
  bookingId: string;
  initialNotes: InterviewNote[];
  clockStart: number | null;
  prefix: string;
}) {
  const [notes, setNotes] = useState(initialNotes);

  // Client attendees write notes too: pick theirs up every 15 seconds.
  useEffect(() => {
    const timer = setInterval(() => {
      loadNotes(bookingId).then(setNotes, () => undefined);
    }, 15_000);
    return () => clearInterval(timer);
  }, [bookingId]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [notes.length]);

  function submit() {
    const body = draft.trim();
    if (!body) return;
    const offset = clockStart === null ? null : Date.now() - clockStart;
    setDraft("");
    setError(null);
    startTransition(async () => {
      try {
        const saved = await saveNote(bookingId, body, offset);
        setNotes((n) => [...n, saved]);
      } catch {
        setDraft(body);
        setError("Couldn't save that note. Please try again.");
      }
    });
  }

  function remove(id: string) {
    const before = notes;
    setNotes((n) => n.filter((x) => x.id !== id));
    startTransition(async () => {
      try {
        await removeNote(bookingId, id);
      } catch {
        setNotes(before);
        setError("Couldn't delete that note.");
      }
    });
  }

  return (
    <section className="flex max-h-[30rem] flex-col rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-900">Notes</h2>
        <p className="text-xs text-neutral-500">
          Not shown to the candidate. Timed against the recording, and added to JobAdder when you end the interview.
        </p>
      </div>
      <ol ref={listRef} className="min-h-[6rem] flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {notes.length === 0 && <li className="text-sm text-neutral-400">No notes yet.</li>}
        {notes.map((n) => (
          <li key={n.id} className="group flex gap-3 text-sm">
            <span className="mt-0.5 w-12 flex-shrink-0 font-mono text-xs text-neutral-400">{formatOffset(n.offsetMs)}</span>
            <p className="flex-1 whitespace-pre-wrap text-neutral-800">
              <span className="text-xs text-neutral-400">{noteLine(prefix, { ...n, body: "" }).trim()}</span> {n.body}
            </p>
            <button
              type="button"
              onClick={() => remove(n.id)}
              aria-label="Delete note"
              className="text-xs text-neutral-400 opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
            >
              ✕
            </button>
          </li>
        ))}
      </ol>
      <div className="space-y-2 border-t border-neutral-200 p-3">
        {error && <p className="text-xs text-red-600">{error}</p>}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={3}
          placeholder="Type a note and press Enter (Shift+Enter for a new line)"
          className="w-full resize-none rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !draft.trim()}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
          >
            Add note
          </button>
        </div>
      </div>
    </section>
  );
}
