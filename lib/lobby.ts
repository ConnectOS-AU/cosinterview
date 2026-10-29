import "server-only";
import sanitizeHtml from "sanitize-html";
import { defaultWaitingRoomContent, type WaitingRoomContent } from "@/content/waiting-room";
import { demoMode } from "./demo";
import { supabaseAdmin } from "./supabase/admin";

// The candidate lobby screen, edited by admins at /r/admin/lobby and stored in
// cos_recruitment_settings (key 'lobby'). Everything is cleaned here on the way
// in and out, so nothing an admin pastes can run script on candidates' pages.

const KEY = "lobby";
const demoStore = globalThis as typeof globalThis & { __cosrecLobby?: WaitingRoomContent };

export const LOBBY_LIMITS = { headline: 120, html: 20_000, tips: 8, tip: 200, ctaLabel: 60 };

export function cleanLobbyHtml(html: string): string {
  return sanitizeHtml(html.slice(0, LOBBY_LIMITS.html), {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "h2", "h3", "h4", "ul", "ol", "li", "a", "blockquote", "hr", "img"],
    // target/rel are only ever the values set below.
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt"] },
    allowedSchemes: ["https", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
    // Images only from full https:// addresses (relative ones would point at this site).
    exclusiveFilter: (frame) => frame.tag === "img" && !/^https:\/\//i.test(frame.attribs.src ?? ""),
  }).trim();
}

// YouTube / Vimeo only, as an embed URL. Accepts the normal watch / share links too.
export function videoEmbedUrl(input: string | null | undefined): string | null {
  const value = input?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "");
  const id = (s: string | null | undefined) => (s && /^[A-Za-z0-9_-]{6,20}$/.test(s) ? s : null);
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "m.youtube.com") {
    const yt = url.pathname.startsWith("/embed/") ? id(url.pathname.split("/")[2]) : id(url.searchParams.get("v"));
    return yt ? `https://www.youtube-nocookie.com/embed/${yt}` : null;
  }
  if (host === "youtu.be") {
    const yt = id(url.pathname.slice(1));
    return yt ? `https://www.youtube-nocookie.com/embed/${yt}` : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const vm = url.pathname.match(/(\d{5,12})/)?.[1];
    return vm ? `https://player.vimeo.com/video/${vm}` : null;
  }
  return null;
}

function cleanLink(href: string | null | undefined): string | null {
  try {
    const url = new URL((href ?? "").trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// Turns whatever came in (the editor, or the stored JSON) into safe content.
export function cleanLobby(input: Partial<WaitingRoomContent> | null | undefined): WaitingRoomContent {
  const d = defaultWaitingRoomContent;
  const ctaHref = cleanLink(input?.cta?.href);
  const ctaLabel = input?.cta?.label?.trim().slice(0, LOBBY_LIMITS.ctaLabel);
  return {
    headline: input?.headline?.trim().slice(0, LOBBY_LIMITS.headline) || d.headline,
    bodyHtml: typeof input?.bodyHtml === "string" ? cleanLobbyHtml(input.bodyHtml) : cleanLobbyHtml(d.bodyHtml),
    videoUrl: videoEmbedUrl(input?.videoUrl),
    tips: (Array.isArray(input?.tips) ? input.tips : d.tips)
      .map((t) => String(t).trim().slice(0, LOBBY_LIMITS.tip))
      .filter(Boolean)
      .slice(0, LOBBY_LIMITS.tips),
    cta: ctaHref && ctaLabel ? { label: ctaLabel, href: ctaHref } : null,
  };
}

export async function getLobbyContent(): Promise<WaitingRoomContent> {
  if (demoMode()) return cleanLobby(demoStore.__cosrecLobby ?? defaultWaitingRoomContent);
  try {
    const { data, error } = await supabaseAdmin().from("cos_recruitment_settings").select("value").eq("key", KEY).maybeSingle();
    if (error) throw new Error(error.message);
    return cleanLobby((data?.value as Partial<WaitingRoomContent> | undefined) ?? defaultWaitingRoomContent);
  } catch (err) {
    // The lobby must still show if settings can't be read.
    console.error("[lobby] Loading the lobby content failed", err);
    return cleanLobby(defaultWaitingRoomContent);
  }
}

export async function saveLobbyContent(content: WaitingRoomContent, updatedBy: string): Promise<void> {
  if (demoMode()) {
    demoStore.__cosrecLobby = content;
    return;
  }
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_settings")
    .upsert({ key: KEY, value: content, updated_at: new Date().toISOString(), updated_by: updatedBy });
  if (error) throw new Error(`Saving the lobby screen failed: ${error.message}`);
}
