"use client";

import { useEffect, useRef, useState } from "react";

// A second-screen window: the interview page opens part of itself in its own
// window (on the other monitor where the browser allows it) and steps that part
// aside until the window closes. Used by the recruiter's interview screen and
// the client lobby.

export type CompanionMessage = { type: "open" | "closed" | "ping" | "close" };
export const companionChannel = (key: string) => `cosrec:companion:${key}`;
// The window says "open" this often; after three missed beats it's gone.
export const HEARTBEAT_MS = 2_000;
const GONE_AFTER_MS = 3 * HEARTBEAT_MS;

type ScreenInfo = { availLeft: number; availTop: number; availWidth: number; availHeight: number };
type ScreenDetails = { screens: ScreenInfo[]; currentScreen: ScreenInfo };

// The page's side: open the window, know whether it's still open, bring it back.
export function useSecondScreen(key: string, url: string) {
  const [popped, setPopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const popup = useRef<Window | null>(null);
  const lastSeen = useRef(0);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(companionChannel(key));
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
  }, [key]);

  async function open() {
    setError(null);
    // Open straight away, while the click still counts (pop-up blockers), then
    // move it to the other screen if the browser will tell us where that is.
    const win = window.open(url, `cosrec-companion-${key.replace(/[^\w-]/g, "-")}`, "popup,width=1100,height=860");
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

  return { popped, error, open, bringBack, focus: () => popup.current?.focus() };
}

// The window's side: tell the page it's open (with a heartbeat, so a crashed or
// killed window is noticed) and close when the page takes the panels back.
export function useCompanionWindow(key: string) {
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel(companionChannel(key));
    const say = (type: CompanionMessage["type"]) => bc.postMessage({ type } satisfies CompanionMessage);
    bc.onmessage = (e: MessageEvent<CompanionMessage>) => {
      if (e.data.type === "ping") say("open");
      if (e.data.type === "close") window.close();
    };
    say("open");
    const heartbeat = setInterval(() => say("open"), HEARTBEAT_MS);
    const onHide = () => say("closed");
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("pagehide", onHide);
      say("closed");
      bc.close();
    };
  }, [key]);
}

// A full-screen toggle for the second-screen window.
export function useFullScreen(): [boolean, () => void] {
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggle = () => void (fullScreen ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined);
  return [fullScreen, toggle];
}
