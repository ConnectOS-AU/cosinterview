"use server";

import { randomBytes } from "node:crypto";
import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import { demoMode } from "@/lib/demo";
import { RECRUITER_PHOTO_BUCKET } from "@/lib/invite";
import { requireRecruiter } from "@/lib/staff/auth";
import { updateRecruiterProfile } from "@/lib/staff/repo";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type ProfileState = { ok: boolean; message: string } | null;

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function text(form: FormData, key: string, max: number): string | null {
  const value = String(form.get(key) ?? "").trim();
  return value ? value.slice(0, max) : null;
}

// What candidates see on their booking page: name, title, photo, bio, welcome.
export async function saveProfile(_prev: ProfileState, form: FormData): Promise<ProfileState> {
  const { recruiter } = await requireRecruiter();

  const displayName = text(form, "displayName", 80);
  if (!displayName) return { ok: false, message: "Your name is required." };
  const timezone = text(form, "timezone", 60) ?? recruiter.timezone;
  if (!DateTime.local().setZone(timezone).isValid) return { ok: false, message: "That time zone isn't valid." };

  let photoPath: string | null | undefined;
  const photo = form.get("photo");
  if (form.get("removePhoto") === "on") {
    photoPath = null;
  } else if (photo instanceof File && photo.size > 0) {
    const ext = PHOTO_TYPES[photo.type];
    if (!ext) return { ok: false, message: "Use a JPG, PNG or WebP photo." };
    if (photo.size > MAX_PHOTO_BYTES) return { ok: false, message: "The photo must be 2 MB or smaller." };
    if (demoMode()) return { ok: false, message: "Photo upload needs Supabase - it isn't available in the local demo." };
    // A new file name each time, so browsers and CDNs never show the old photo.
    photoPath = `recruiters/${recruiter.id}/${randomBytes(8).toString("hex")}.${ext}`;
    const { error } = await supabaseAdmin()
      .storage.from(RECRUITER_PHOTO_BUCKET)
      .upload(photoPath, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type, cacheControl: "31536000" });
    if (error) {
      console.error("[profile] photo upload failed", error);
      return { ok: false, message: "The photo couldn't be uploaded. Please try again." };
    }
  }

  await updateRecruiterProfile(recruiter.id, {
    displayName,
    title: text(form, "title", 80),
    bio: text(form, "bio", 600),
    welcomeMessage: text(form, "welcomeMessage", 600),
    timezone,
    photoPath,
  });

  // Tidy up the replaced photo; a failure here only leaves an orphan file.
  if (photoPath !== undefined && recruiter.photoPath && !demoMode()) {
    const { error } = await supabaseAdmin().storage.from(RECRUITER_PHOTO_BUCKET).remove([recruiter.photoPath]);
    if (error) console.error("[profile] removing old photo failed", error);
  }

  revalidatePath("/r", "layout");
  return { ok: true, message: "Saved. Candidates will see this on their booking page." };
}
