"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { addRecruiter, setAccess, type AddRecruiterState } from "./actions";

const INPUT = "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";

export function AccessToggle({
  recruiterId,
  field,
  value,
  disabled,
}: {
  recruiterId: string;
  field: "active" | "isAdmin";
  value: boolean;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="inline-flex items-center gap-2" title={disabled ? "You can't change this for yourself." : undefined}>
      <input
        type="checkbox"
        checked={value}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.checked;
          if (field === "active" && !next && !window.confirm("Deactivate this recruiter? They won't be able to use COSInterview.")) return;
          setError(null);
          startTransition(async () => {
            const res = await setAccess(recruiterId, field, next);
            if (res.error) setError(res.error);
          });
        }}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function AddRecruiterForm() {
  const [state, action, pending] = useActionState<AddRecruiterState, FormData>(addRecruiter, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium text-neutral-800">Name</span>
          <input name="displayName" required maxLength={80} className={INPUT} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-neutral-800">Microsoft email</span>
          <input name="email" type="email" required maxLength={200} placeholder="name@connectos.co" className={INPUT} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-neutral-800">Job title</span>
          <input name="title" maxLength={80} placeholder="Recruitment Consultant" className={INPUT} />
        </label>
      </div>
      <p className="text-xs text-neutral-500">
        The email they sign in with. Their Outlook calendar is used for free times, so it must be their own mailbox.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-neutral-700">
          <input type="checkbox" name="isAdmin" />
          Admin
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add recruiter"}
        </button>
        {state && <span className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
