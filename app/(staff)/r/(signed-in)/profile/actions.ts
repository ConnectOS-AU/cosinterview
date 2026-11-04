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

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
// Daily's background effect takes JPG and PNG only.
const BACKGROUND_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };

function text(form: FormData, key: string, max: number): string | null {
  const value = String(form.get(key) ?? "").trim();
  return value ? value.slice(0, max) : null;
}

// The chosen image's new storage path, or what to tell the recruiter instead.
async function uploadImage(recruiterId: string, file: File, types: Record<string, string>, label: string): Promise<{ path: string } | { problem: string }> {
  const ext = types[file.type];
  if (!ext) return { problem: `Use a ${Object.values(types).join(", ").toUpperCase()} ${label}.` };
  if (file.size > MAX_IMAGE_BYTES) return { problem: `The ${label} must be 2 MB or smaller.` };
  if (demoMode()) return { problem: `Uploading a ${label} needs Supabase - it isn't available in the local demo.` };
  // A new file name each time, so browsers and CDNs never show the old image.
  const path = `recruiters/${recruiterId}/${randomBytes(8).toString("hex")}.${ext}`;
  const { error } = await supabaseAdmin()
    .storage.from(RECRUITER_PHOTO_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, cacheControl: "31536000" });
  if (error) {
    console.error("[profile] image upload failed", error);
    return { problem: `The ${label} couldn't be uploaded. Please try again.` };
  }
  return { path };
}

// What candidates see on their booking page (name, title, photo, bio, welcome)
// and the background they see behind the recruiter in interviews.
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
    const uploaded = await uploadImage(recruiter.id, photo, PHOTO_TYPES, "photo");
    if ("problem" in uploaded) return { ok: false, message: uploaded.problem };
    photoPath = uploaded.path;
  }

  let interviewBackgroundPath: string | null | undefined;
  const background = form.get("background");
  if (form.get("removeBackground") === "on") {
    interviewBackgroundPath = null;
  } else if (background instanceof File && background.size > 0) {
    const uploaded = await uploadImage(recruiter.id, background, BACKGROUND_TYPES, "background");
    if ("problem" in uploaded) return { ok: false, message: uploaded.problem };
    interviewBackgroundPath = uploaded.path;
  }

  await updateRecruiterProfile(recruiter.id, {
    displayName,
    title: text(form, "title", 80),
    bio: text(form, "bio", 600),
    welcomeMessage: text(form, "welcomeMessage", 600),
    timezone,
    photoPath,
    interviewBackgroundPath,
  });

  // Tidy up replaced images; a failure here only leaves an orphan file.
  const replaced = [photoPath !== undefined && recruiter.photoPath, interviewBackgroundPath !== undefined && recruiter.interviewBackgroundPath].filter(
    (path): path is string => Boolean(path),
  );
  if (replaced.length && !demoMode()) {
    const { error } = await supabaseAdmin().storage.from(RECRUITER_PHOTO_BUCKET).remove(replaced);
    if (error) console.error("[profile] removing old images failed", error);
  }

  revalidatePath("/r", "layout");
  return { ok: true, message: "Saved. Candidates will see this on their booking page and in interviews." };
}
