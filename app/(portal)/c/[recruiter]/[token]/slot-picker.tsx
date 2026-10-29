"use client";

import { DateTime } from "luxon";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDay, formatTime, formatZone } from "@/lib/format";
import { PRIVACY_POLICY_URL } from "@/lib/site";
import { bookInterview } from "./actions";

type Props = {
  recruiterSlug: string;
  token: string;
  slots: string[];
  durationMins: number;
  recruiterFirstName: string;
};

// Day chips, then times for that day, in the candidate's own time zone
// (detected from the browser), then WhatsApp/Viber numbers (optional), consent and book.
export function SlotPicker({ recruiterSlug, token, slots, durationMins, recruiterFirstName }: Props) {
  const router = useRouter();
  const [zone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Manila");
  const days = useMemo(() => groupByDay(slots, zone), [slots, zone]);
  const [dayKey, setDayKey] = useState<string | null>(days[0]?.key ?? null);
  const [slot, setSlot] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [whatsapp, setWhatsapp] = useState("");
  const [viber, setViber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (days.length === 0) {
    return (
      <p className="rounded-xl border border-brand-line bg-brand-sunken px-4 py-3 text-brand-text">
        There are no times available in the next two weeks. Please reply to your invitation email and{" "}
        {recruiterFirstName} will find a time with you.
      </p>
    );
  }

  const day = days.find((d) => d.key === dayKey) ?? days[0]!;

  function book() {
    if (!slot) return;
    setError(null);
    startTransition(async () => {
      const result = await bookInterview({ recruiter: recruiterSlug, token, slotStart: slot, timezone: zone, consent, whatsapp, viber });
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(result.error);
      if (result.refresh) {
        setSlot(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-medium text-brand-ink">Choose a day</h2>
          <p className="text-xs text-brand-faint">Times shown in {formatZone(zone)} time</p>
        </div>
        <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
          {days.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => {
                setDayKey(d.key);
                setSlot(null);
              }}
              className={`flex min-w-[4.5rem] flex-shrink-0 flex-col items-center rounded-xl border px-3 py-2 text-sm transition ${
                d.key === day.key
                  ? "border-brand-teal bg-brand-teal text-brand-on-teal shadow-card"
                  : "border-brand-line bg-brand-surface text-brand-text hover:border-brand-teal/50"
              }`}
            >
              <span className="text-xs uppercase tracking-wide opacity-80">{d.weekday}</span>
              <span className="text-lg font-semibold leading-tight">{d.date}</span>
              <span className="text-xs opacity-80">{d.month}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h2 className="font-medium text-brand-ink">{formatDay(day.slots[0]!, zone)}</h2>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {day.slots.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSlot(s)}
              aria-pressed={s === slot}
              className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${
                s === slot
                  ? "border-brand-teal bg-brand-teal-tint text-brand-teal-dark ring-2 ring-brand-teal/30"
                  : "border-brand-line bg-brand-surface text-brand-text hover:border-brand-teal/50"
              }`}
            >
              {formatTime(s, zone)}
            </button>
          ))}
        </div>
      </div>

      {slot && (
        <div className="space-y-4 rounded-2xl border border-brand-line bg-brand-sunken p-4 animate-fade-up">
          <p className="text-brand-ink">
            <span className="font-medium">{formatDay(slot, zone)}</span> at{" "}
            <span className="font-medium">{formatTime(slot, zone)}</span>
            <span className="text-brand-muted"> &middot; {durationMins} minutes</span>
          </p>
          <fieldset className="space-y-3">
            <legend className="text-sm text-brand-text">
              Want your confirmation and reminders on WhatsApp or Viber too? Add your numbers{" "}
              <span className="text-brand-faint">(optional)</span>
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <PhoneField id="whatsapp" label="WhatsApp number" value={whatsapp} onChange={setWhatsapp} />
              <PhoneField
                id="viber"
                label="Viber number"
                value={viber}
                onChange={setViber}
                action={
                  whatsapp.trim() && viber !== whatsapp ? (
                    <button type="button" onClick={() => setViber(whatsapp)} className="text-xs text-brand-teal underline">
                      Same as WhatsApp
                    </button>
                  ) : null
                }
              />
            </div>
            <p className="text-xs text-brand-faint">Include your country code if you&apos;re outside the Philippines, e.g. +61 412 345 678.</p>
          </fieldset>
          <label className="flex items-start gap-3 text-sm text-brand-text">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[rgb(var(--c-teal))]"
            />
            <span>
              I agree to this interview being recorded and transcribed so ConnectOS can assess my application, as set
              out in the{" "}
              <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer" className="text-brand-teal underline">
                privacy policy
              </a>
              .
            </span>
          </label>
          {error && (
            <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={book}
            disabled={!consent || pending}
            className="flex w-full items-center justify-center rounded-xl bg-brand-teal px-4 py-3 text-base font-medium text-brand-on-teal shadow-card transition hover:bg-brand-teal-dark active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Booking…" : "Book this time"}
          </button>
        </div>
      )}
      {!slot && error && (
        <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}

function PhoneField({
  id,
  label,
  value,
  onChange,
  action,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  action?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-brand-muted">
          {label}
        </label>
        {action}
      </div>
      <input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="0917 123 4567"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={24}
        className="mt-1 w-full rounded-lg border border-brand-line bg-brand-surface px-3 py-2 text-sm text-brand-ink placeholder:text-brand-faint focus:border-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30"
      />
    </div>
  );
}

type Day = { key: string; weekday: string; date: string; month: string; slots: string[] };

function groupByDay(slots: string[], zone: string): Day[] {
  const days = new Map<string, Day>();
  for (const s of slots) {
    const local = DateTime.fromISO(s, { zone });
    const key = local.toISODate()!;
    let day = days.get(key);
    if (!day) {
      day = { key, weekday: local.toFormat("ccc"), date: local.toFormat("d"), month: local.toFormat("LLL"), slots: [] };
      days.set(key, day);
    }
    day.slots.push(s);
  }
  return [...days.values()];
}
