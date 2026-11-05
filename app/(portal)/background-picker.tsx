"use client";

import { useEffect, useRef, useState } from "react";
import { imageForBackground, processorFor, saveBackground, savedBackground, type Background } from "@/lib/lobby-background";

// Lets a candidate or attendee choose a virtual background while they wait. It
// applies straight away if their camera is on, and otherwise when they join.
export function BackgroundPicker({ failed }: { failed: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [supported, setSupported] = useState(false);
  const [choice, setChoice] = useState<Background>({ kind: "off" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("@daily-co/daily-js").then(({ default: Daily }) => {
      if (cancelled) return;
      setSupported(Daily.supportedBrowser().supportsVideoProcessing);
      setChoice(savedBackground());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function choose(next: Background) {
    setChoice(next);
    setError(null);
    saveBackground(next);
    const Daily = (await import("@daily-co/daily-js")).default;
    await Daily.getCallInstance()?.updateInputSettings({ video: { processor: processorFor(next) } });
  }

  function pick(next: Background) {
    choose(next).catch((err) => {
      console.error("[background]", err);
      setError("That background couldn't be applied. Please try another.");
    });
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    try {
      pick({ kind: "image", dataUrl: await imageForBackground(file) });
    } catch (err) {
      console.error("[background]", err);
      setError("That image couldn't be read. Please try a JPG or PNG.");
    }
  }

  if (!supported) return null;
  const option = (active: boolean) =>
    `rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
      active ? "border-brand-teal bg-brand-teal-tint text-brand-teal" : "border-brand-line text-brand-muted hover:text-brand-ink"
    }`;

  return (
    <section className="rounded-2xl border border-brand-line bg-brand-surface p-4 shadow-card">
      <h2 className="text-sm font-medium text-brand-ink">Virtual background</h2>
      <p className="mt-1 text-sm text-brand-muted">Shown behind you in the interview. Your image stays on this device.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" aria-pressed={choice.kind === "off"} onClick={() => pick({ kind: "off" })} className={option(choice.kind === "off")}>
          Off
        </button>
        <button type="button" aria-pressed={choice.kind === "blur"} onClick={() => pick({ kind: "blur" })} className={option(choice.kind === "blur")}>
          Blur
        </button>
        <button type="button" aria-pressed={choice.kind === "image"} onClick={() => inputRef.current?.click()} className={option(choice.kind === "image")}>
          {choice.kind === "image" ? "Change image" : "Use an image"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          aria-label="Background image"
          className="hidden"
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {choice.kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- a local preview of their own image
        <img src={choice.dataUrl} alt="Your background" className="mt-3 h-20 w-36 rounded-lg object-cover" />
      )}
      {(error || failed) && (
        <p className="mt-2 text-sm text-red-600">{error ?? "Your background couldn't be shown, so your camera has been turned off. Choose Off or try another."}</p>
      )}
    </section>
  );
}
