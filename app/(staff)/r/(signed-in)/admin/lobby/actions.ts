"use server";

import { revalidatePath } from "next/cache";
import { defaultWaitingRoomContent, type WaitingRoomContent } from "@/content/waiting-room";
import { cleanLobby, cleanRichHtml, saveLobbyContent } from "@/lib/lobby";
import { requireAdmin } from "@/lib/staff/auth";

export type LobbyInput = {
  headline: string;
  bodyHtml: string;
  videoUrl: string;
  tipsHtml: string;
  interviewTipsTitle: string;
  interviewTipsHtml: string;
  jobLinkLabel: string;
  ctaLabel: string;
  ctaHref: string;
};

export type SaveLobbyResult = { ok: true; content: WaitingRoomContent; warnings: string[] } | { ok: false; error: string };

function toContent(input: LobbyInput): Partial<WaitingRoomContent> {
  const { ctaLabel, ctaHref, ...rest } = input;
  return { ...rest, cta: { label: ctaLabel, href: ctaHref } };
}

// What the candidate would see, for the editor's live preview. Admin-only like
// saving, so the cleaner isn't open to anyone.
export async function previewLobby(input: LobbyInput): Promise<WaitingRoomContent> {
  await requireAdmin();
  return cleanLobby(toContent(input));
}

// One panel's HTML, cleaned - for loading it into the visual editor.
export async function cleanPanelHtml(html: string): Promise<string> {
  await requireAdmin();
  return cleanRichHtml(html);
}

export async function saveLobby(input: LobbyInput): Promise<SaveLobbyResult> {
  const { own } = await requireAdmin();
  const content = cleanLobby(toContent(input));
  const warnings: string[] = [];
  if (input.videoUrl.trim() && !content.videoUrl) warnings.push("The video link wasn't a YouTube or Vimeo link, so it was left out.");
  if ((input.ctaLabel.trim() || input.ctaHref.trim()) && !content.cta) {
    warnings.push("The button needs both a label and an https:// link, so it was left out.");
  }
  try {
    await saveLobbyContent(content, own.calendarEmail);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Saving failed." };
  }
  revalidatePath("/r/admin/lobby");
  return { ok: true, content, warnings };
}

export async function resetLobby(): Promise<SaveLobbyResult> {
  const { own } = await requireAdmin();
  const content = cleanLobby(defaultWaitingRoomContent);
  try {
    await saveLobbyContent(content, own.calendarEmail);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Saving failed." };
  }
  revalidatePath("/r/admin/lobby");
  return { ok: true, content, warnings: [] };
}
