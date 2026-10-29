"use client";

import { useState } from "react";

// Copies an invite link. Clipboard access inside COSHub's frame needs the
// iframe's clipboard-write permission, so there's a select-the-text fallback.
export function CopyButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("manual");
    }
  }

  if (state === "manual") {
    return (
      <input
        readOnly
        value={value}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        className="w-full max-w-md rounded-md border border-neutral-300 px-2 py-1 font-mono text-xs"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
    >
      {state === "copied" ? "Copied" : label}
    </button>
  );
}
