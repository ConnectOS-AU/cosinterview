"use client";

import { useRef, useState, useTransition } from "react";
import type { LinkedinPdf } from "@/lib/linkedin-pdf";
import { deleteLinkedinPdf, uploadLinkedinPdf } from "./actions";

const LINK_BUTTON = "text-xs font-medium text-neutral-700 underline hover:text-neutral-950 disabled:opacity-50";

// The candidate's LinkedIn profile as a PDF, a row in Documents. Uploading it
// (re)writes the candidate overview, which compares it with the resume.
export function LinkedinPdfRow({ bookingId, pdf: initial }: { bookingId: string; pdf: LinkedinPdf | null }) {
  const [pdf, setPdf] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    setError(null);
    setMessage(null);
    const form = new FormData();
    form.set("file", file);
    startTransition(async () => {
      const res = await uploadLinkedinPdf(bookingId, form);
      if (inputRef.current) inputRef.current.value = "";
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPdf(res.pdf);
      setMessage("The candidate overview is being rewritten with the comparison. This takes a minute or two.");
    });
  }

  function remove() {
    if (!window.confirm("Remove this LinkedIn PDF? The candidate overview will be rewritten without the comparison.")) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await deleteLinkedinPdf(bookingId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPdf(null);
    });
  }

  return (
    <li className="py-2">
      {pdf ? (
        <div>
          <a href={`/r/bookings/${bookingId}/linkedin-pdf`} target="_blank" rel="noopener" className="break-all font-medium text-neutral-800 underline hover:text-neutral-950">
            {pdf.fileName}
          </a>
          <p className="text-xs text-neutral-500">
            <span className="mr-1.5 rounded bg-neutral-100 px-1.5 py-px font-medium text-neutral-600">LinkedIn profile</span>
            Uploaded by {pdf.uploadedBy},{" "}
            {new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(pdf.uploadedAt))}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <a href={`/r/bookings/${bookingId}/overview`} className={LINK_BUTTON}>
              See the comparison
            </a>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={pending} className={LINK_BUTTON}>
              {pending ? "Working…" : "Replace"}
            </button>
            <button type="button" onClick={remove} disabled={pending} className={LINK_BUTTON}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="font-medium text-neutral-800">LinkedIn profile</p>
          <p className="text-xs text-neutral-500">
            Upload the candidate&apos;s profile to compare it with their resume in the candidate overview. On their LinkedIn profile, choose More, then Save to PDF.
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
            className="mt-2 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100 disabled:opacity-50"
          >
            {pending ? "Uploading…" : "Upload PDF"}
          </button>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        aria-label="LinkedIn profile PDF"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
        }}
      />
      {message && <p className="mt-2 text-xs text-emerald-700">{message}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </li>
  );
}
