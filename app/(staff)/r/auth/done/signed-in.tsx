"use client";

import { useEffect } from "react";

// Tells the framed login page (in COSHub) that sign-in finished. Microsoft's
// pages can cut the pop-up's link to its opener, so a same-site
// BroadcastChannel is the main signal and postMessage a backup.
export function SignedIn({ next }: { next: string }) {
  useEffect(() => {
    const inPopup = window.name === "cosrec-sign-in";
    try {
      const channel = new BroadcastChannel("cosrec-auth");
      channel.postMessage({ type: "cosrec:signed-in" });
      channel.close();
    } catch {
      // BroadcastChannel unsupported - postMessage below.
    }
    try {
      window.opener?.postMessage({ type: "cosrec:signed-in" }, window.location.origin);
    } catch {
      // Opener gone or on another origin.
    }
    if (inPopup) window.close();
    else window.location.replace(next);
  }, [next]);

  return <p className="p-6 text-sm text-neutral-500">Signed in. You can close this window.</p>;
}
