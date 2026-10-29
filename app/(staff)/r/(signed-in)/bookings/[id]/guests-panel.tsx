"use client";

import { useState, useTransition } from "react";
import type { Guest } from "@/lib/guests";
import { GUEST_ROLE_LABEL, MAX_GUESTS, type GuestRole } from "@/lib/stages";
import { CopyButton } from "../../interviews/copy-button";
import { inviteGuest, resendGuest, uninviteGuest, type GuestResult } from "./actions";

// Extra people on the interview, invited by email: client attendees (up to 5,
// client interviews only) and Other - another recruiter or a last-minute
// addition (up to 5, any interview). Each gets a personal link to the attendee
// lobby (the candidate's formatted resume, the job description and their own
// notes); the recruiter admits them from the lobby list once they're waiting.
export function GuestsPanel({
  bookingId,
  initialGuests,
  canEmail,
  open,
  clientStage,
}: {
  bookingId: string;
  initialGuests: Guest[];
  canEmail: boolean;
  open: boolean;
  clientStage: boolean;
}) {
  const roles: GuestRole[] = clientStage ? ["client", "other"] : ["other"];
  const [guests, setGuests] = useState(initialGuests);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<GuestRole>(roles[0]!);
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const count = (r: GuestRole) => guests.filter((g) => g.role === r).length;
  const roleFull = count(role) >= MAX_GUESTS[role];
  const anyRoom = roles.some((r) => count(r) < MAX_GUESTS[r]);

  function apply(res: GuestResult, forEmail?: string) {
    if (!res.ok) return setMessage(res.error);
    setGuests(res.guests);
    if (res.link && forEmail) {
      setLink({ email: forEmail, url: res.link });
      setMessage(
        res.emailed ? `Emailed ${forEmail}. You can also copy their link:` : canEmail ? "The email couldn't be sent - copy their link instead:" : "Copy their link and send it to them:",
      );
    }
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    const address = email.trim();
    setMessage(null);
    setLink(null);
    startTransition(async () => {
      const res = await inviteGuest(bookingId, address, name, role, canEmail);
      apply(res, address);
      if (res.ok) {
        setEmail("");
        setName("");
      }
    });
  }

  function resend(g: Guest) {
    if (!window.confirm(`Send ${g.email} a new link? Their old link will stop working.`)) return;
    setMessage(null);
    setLink(null);
    startTransition(async () => apply(await resendGuest(bookingId, g.id, canEmail), g.email));
  }

  function remove(g: Guest) {
    if (!window.confirm(`Remove ${g.email}? Their link will stop working.`)) return;
    setMessage(null);
    setLink(null);
    startTransition(async () => apply(await uninviteGuest(bookingId, g.id)));
  }

  const btn = "text-xs font-medium text-neutral-600 underline hover:text-neutral-950 disabled:opacity-40";
  const input = "rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-neutral-500 focus:outline-none";
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-neutral-900">{clientStage ? "Client attendees and others" : "Other attendees"}</h2>
        <span className="text-xs text-neutral-500">{roles.map((r) => `${GUEST_ROLE_LABEL[r]} ${count(r)} of ${MAX_GUESTS[r]}`).join(" · ")}</span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        Add {clientStage ? "the client's interviewers, or " : ""}anyone else joining - another recruiter or a last-minute addition. Each person gets their own
        link to a lobby with the formatted resume, job description and a notes pad, and waits there until you admit them.
      </p>

      {guests.length > 0 && (
        <ul className="mt-3 divide-y divide-neutral-100 text-sm">
          {guests.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-neutral-800">
                  {g.name || g.email}
                  <span
                    className={`ml-2 rounded px-1.5 py-px text-xs font-medium ${g.role === "client" ? "bg-amber-50 text-amber-800" : "bg-violet-50 text-violet-800"}`}
                  >
                    {GUEST_ROLE_LABEL[g.role]}
                  </span>
                </p>
                <p className="truncate text-xs text-neutral-500">
                  {g.name ? `${g.email} · ` : ""}
                  {g.invitedAt ? "Emailed" : "Not emailed"}
                </p>
              </div>
              {open && (
                <div className="flex gap-3">
                  <button type="button" className={btn} disabled={pending} onClick={() => resend(g)}>
                    New link
                  </button>
                  <button type="button" className={btn} disabled={pending} onClick={() => remove(g)}>
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && anyRoom && (
        <form onSubmit={add} className="mt-3 flex flex-wrap items-center gap-2">
          {roles.length > 1 && (
            <select value={role} onChange={(e) => setRole(e.target.value as GuestRole)} aria-label="Who they are" className={input}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {GUEST_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          )}
          <input type="email" required placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} className={`${input} min-w-0 flex-1`} />
          <input type="text" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} className={`${input} w-40`} maxLength={120} />
          <button
            type="submit"
            disabled={pending || !email.trim() || roleFull}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            {canEmail ? "Invite" : "Add"}
          </button>
          {roleFull && <p className="w-full text-xs text-amber-700">That&apos;s the most {GUEST_ROLE_LABEL[role].toLowerCase()} attendees for one interview.</p>}
        </form>
      )}

      {message && <p className="mt-2 text-xs text-neutral-600">{message}</p>}
      {link && (
        <div className="mt-1.5 flex items-center gap-2">
          <CopyButton value={link.url} />
          <button type="button" className={btn} onClick={() => (setLink(null), setMessage(null))}>
            Done
          </button>
        </div>
      )}
    </section>
  );
}
