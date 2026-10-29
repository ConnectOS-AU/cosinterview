"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { BookingStatus } from "@/lib/types";
import { cancelBooking, rescheduleBooking, resendInvite } from "./actions";
import { ROW_BUTTON, ROW_BUTTON_DANGER } from "./button-styles";
import { CopyButton } from "./copy-button";

// Row actions on the interviews list: a fresh link for someone who hasn't
// booked, move a booked time, or cancel.
export function BookingActions({ bookingId, status, canEmail }: { bookingId: string; status: BookingStatus; canEmail: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  function run(kind: "resend" | "reschedule" | "cancel") {
    const prompts = {
      resend: "Create a new invite link? The old link will stop working.",
      reschedule: "Free up this time and send the candidate a new link to choose another? The Outlook entry will be cancelled.",
      cancel: "Cancel this interview? The candidate's link will stop working.",
    };
    if (!window.confirm(prompts[kind])) return;
    setMessage(null);
    setLink(null);
    startTransition(async () => {
      if (kind === "cancel") {
        const res = await cancelBooking(bookingId);
        if (!res.ok) setMessage(res.error);
        return;
      }
      const res = kind === "resend" ? await resendInvite(bookingId, canEmail) : await rescheduleBooking(bookingId, canEmail);
      if (!res.ok) return setMessage(res.error);
      setLink(res.link);
      setMessage(res.emailed ? "Emailed." : res.error ?? "Copy the new link:");
    });
  }

  const btn = "text-xs font-medium text-neutral-600 underline hover:text-neutral-950 disabled:opacity-40";
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center justify-end gap-2 whitespace-nowrap">
        {status === "invited" && (
          <button type="button" className={ROW_BUTTON} disabled={pending} onClick={() => run("resend")}>
            New link
          </button>
        )}
        {status === "booked" && (
          <button type="button" className={ROW_BUTTON} disabled={pending} onClick={() => run("reschedule")}>
            Reschedule
          </button>
        )}
        {(status === "invited" || status === "booked") && (
          <button type="button" className={ROW_BUTTON_DANGER} disabled={pending} onClick={() => run("cancel")}>
            Cancel
          </button>
        )}
      </div>
      {message && <p className="text-xs text-neutral-500">{message}</p>}
      {link && (
        <div className="flex items-center gap-2">
          <CopyButton value={link} />
          <button
            type="button"
            className={btn}
            onClick={() => {
              setLink(null);
              setMessage(null);
              router.refresh();
            }}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
