"use client";

import { useEffect, useState } from "react";

// Microsoft's sign-in page refuses to load inside a frame, so when this page is
// shown in COSHub's content pane the sign-in runs in a pop-up, which tells this
// frame when it's done (see /r/auth/done). Outside a frame it's a normal redirect.
export function SignInButton({ next }: { next: string }) {
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    const done = () => {
      window.location.href = next;
    };
    function onMessage(event: MessageEvent) {
      if (event.origin === window.location.origin && event.data?.type === "cosrec:signed-in") done();
    }
    window.addEventListener("message", onMessage);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("cosrec-auth");
      channel.onmessage = (event) => {
        if (event.data?.type === "cosrec:signed-in") done();
      };
    } catch {
      // BroadcastChannel unsupported - postMessage or the Continue link instead.
    }
    return () => {
      window.removeEventListener("message", onMessage);
      channel?.close();
    };
  }, [next]);

  function signIn() {
    const start = `/r/auth/start?next=${encodeURIComponent(next)}`;
    if (window.self === window.top) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a route handler that redirects to Microsoft, so a full navigation
      window.location.href = start;
      return;
    }
    const popup = window.open(start, "cosrec-sign-in", "width=520,height=700");
    if (!popup) {
      window.top!.location.href = start; // pop-ups blocked: leave COSHub for the sign-in instead
      return;
    }
    setWaiting(true);
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={signIn}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
      >
        <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
          <rect x="1" y="1" width="9" height="9" fill="#f25022" />
          <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
          <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
          <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
        </svg>
        Sign in with Microsoft
      </button>
      {waiting && (
        <p className="text-xs text-neutral-500">
          Finish signing in in the pop-up window.{" "}
          <a href={next} className="font-medium text-neutral-700 underline">
            Continue
          </a>{" "}
          once you&apos;re done.
        </p>
      )}
    </div>
  );
}
