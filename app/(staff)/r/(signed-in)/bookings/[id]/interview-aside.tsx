"use client";

import { useEffect, useRef, useState } from "react";
import type { ReviewQuestion } from "@/lib/worker/review";
import { JobDescriptionPane } from "./job-description-pane";
import { QuestionsPanel } from "./questions-panel";

// Messages between the interview screen and its second-screen window.
export type CompanionMessage = { type: "open" | "closed" | "ping" | "close" };
export const companionChannel = (bookingId: string) => `cosrec:companion:${bookingId}`;
// The window says "open" this often; after three missed beats it's gone.
export const HEARTBEAT_MS = 2_000;
const GONE_AFTER_MS = 3 * HEARTBEAT_MS;

type ScreenInfo = { availLeft: number; availTop: number; availWidth: number; availHeight: number };
type ScreenDetails = { screens: ScreenInfo[]; currentScreen: ScreenInfo };

// Beside the video: the job description and the questions to ask. "Second
// screen" moves both into their own window - on the other monitor where the
// browser allows it (Window Management permission), otherwise wherever the
// interviewer drags it - and this column steps aside until it's closed.
export function InterviewAside({
  bookingId,
  jobTitle,
  jobHtml,
  questions,
  reviewStatus,
}: {
  bookingId: string;
  jobTitle: string | null;
  jobHtml: string | null;
  questions: ReviewQuestion[] | null;
  reviewStatus: string;
}) {
  const [popped, setPopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const popup = useRef<Window | null>(null);
  const lastSeen = useRef(0);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(companionChannel(bookingId));
    channel.current = bc;
    bc.onmessage = (e: MessageEvent<CompanionMessage>) => {
      if (e.data.type === "open") {
        lastSeen.current = Date.now();
        setPopped(true);
      }
      if (e.data.type === "closed") setPopped(false);
    };
    // A second-screen window left open from before this page loaded.
    bc.postMessage({ type: "ping" } satisfies CompanionMessage);
    // Take the panels back if the window closed without saying so.
    const watch = setInterval(() => {
      if (Date.now() - lastSeen.current > GONE_AFTER_MS || popup.current?.closed) setPopped(false);
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(watch);
      bc.close();
      channel.current = null;
    };
  }, [bookingId]);

  async function openSecondScreen() {
    setError(null);
    const url = `/r/companion/${bookingId}`;
    // Open straight away, while the click still counts (pop-up blockers), then
    // move it to the other screen if the browser will tell us where that is.
    const win = window.open(url, `cosrec-companion-${bookingId}`, "popup,width=1100,height=860");
    if (!win) {
      setError("Your browser blocked the window. Allow pop-ups for this site, then try again.");
      return;
    }
    popup.current = win;
    // Give the new window time to load before expecting its heartbeat.
    lastSeen.current = Date.now() + 10_000;
    setPopped(true);
    try {
      const getScreenDetails = (window as Window & { getScreenDetails?: () => Promise<ScreenDetails> }).getScreenDetails;
      if (!getScreenDetails) return;
      const details = await getScreenDetails.call(window);
      const other = details.screens.find((s) => s !== details.currentScreen);
      if (!other) return;
      win.moveTo(other.availLeft, other.availTop);
      win.resizeTo(other.availWidth, other.availHeight);
    } catch {
      // Permission refused, or not allowed inside COSHub's frame: the window
      // opens on this screen and can be dragged across.
    }
  }

  function bringBack() {
    channel.current?.postMessage({ type: "close" } satisfies CompanionMessage);
    popup.current?.close();
    setPopped(false);
  }

  if (popped) {
    return (
      <section className="space-y-3 rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-5 text-sm text-neutral-600">
        <p>The job description and questions are open in their own window, on your second screen.</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => popup.current?.focus()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
          >
            Show that window
          </button>
          <button type="button" onClick={bringBack} className="text-xs font-medium text-neutral-700 underline hover:text-neutral-950">
            Bring them back here
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end gap-3">
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button
          type="button"
          onClick={openSecondScreen}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
          title="Open the job description and questions in their own window, to put on a second monitor"
        >
          Move to second screen ⧉
        </button>
      </div>
      <JobDescriptionPane jobTitle={jobTitle} html={jobHtml} sizeClass="max-h-[30rem] lg:max-h-[calc(55vh)]" />
      <QuestionsPanel bookingId={bookingId} questions={questions} reviewStatus={reviewStatus} sizeClass="max-h-[28rem] lg:max-h-[calc(45vh-6rem)]" />
    </>
  );
}
