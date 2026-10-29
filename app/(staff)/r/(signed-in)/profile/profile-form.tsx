"use client";

import { useActionState, useState } from "react";
import { initials } from "@/lib/format";
import { saveProfile, type ProfileState } from "./actions";

type Profile = {
  displayName: string;
  title: string;
  bio: string;
  welcomeMessage: string;
  timezone: string;
  photoUrl: string | null;
  calendarEmail: string;
};

const ZONES = ["Asia/Manila", "Australia/Sydney", "Australia/Brisbane", "Australia/Melbourne", "Australia/Perth", "America/New_York", "America/Los_Angeles", "Europe/London"];

const INPUT = "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(saveProfile, null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const shown = removePhoto ? null : (preview ?? profile.photoUrl);
  const zones = ZONES.includes(profile.timezone) ? ZONES : [profile.timezone, ...ZONES];

  return (
    <form action={action} className="space-y-5 rounded-lg border border-neutral-200 bg-white p-6">
      <div className="flex items-center gap-5">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview or Supabase Storage URL
          <img src={shown} alt="" className="h-20 w-20 rounded-full object-cover ring-1 ring-neutral-200" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-100 text-xl font-semibold text-neutral-500">
            {initials(profile.displayName)}
          </div>
        )}
        <div className="space-y-1.5 text-sm">
          <input
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setRemovePhoto(false);
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
            className="block text-sm file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          <p className="text-xs text-neutral-500">A friendly, well-lit head-and-shoulders photo. JPG, PNG or WebP, up to 2 MB.</p>
          {profile.photoUrl && (
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              <input type="checkbox" name="removePhoto" checked={removePhoto} onChange={(e) => setRemovePhoto(e.target.checked)} />
              Remove my photo
            </label>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name candidates see">
          <input name="displayName" required maxLength={80} defaultValue={profile.displayName} className={INPUT} />
        </Field>
        <Field label="Job title">
          <input name="title" maxLength={80} defaultValue={profile.title} placeholder="Talent Acquisition Specialist" className={INPUT} />
        </Field>
      </div>

      <Field label="Welcome message" hint="The first thing candidates read. Keep it short and warm.">
        <textarea name="welcomeMessage" rows={3} maxLength={600} defaultValue={profile.welcomeMessage} className={INPUT} />
      </Field>
      <Field label="About you" hint="A sentence or two about your experience.">
        <textarea name="bio" rows={3} maxLength={600} defaultValue={profile.bio} className={INPUT} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your time zone" hint="Working hours for bookings are set in this zone.">
          <select name="timezone" defaultValue={profile.timezone} className={INPUT}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Outlook calendar" hint="Bookings go into this calendar. Ask an admin to change it.">
          <input value={profile.calendarEmail} disabled className={`${INPUT} bg-neutral-50 text-neutral-500`} />
        </Field>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>
        {state && <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`}>{state.message}</p>}
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-neutral-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}
