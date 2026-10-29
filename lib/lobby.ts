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

export const LOBBY_LIMITS = { headline: 120, title: 80, html: 20_000, ctaLabel: 60 };

// Rich text that's safe to show candidates: the lobby panels, and job
// descriptions from JobAdder. Unknown tags are dropped but their text is kept.
export function cleanRichHtml(html: string, maxLength = LOBBY_LIMITS.html): string {
  return sanitizeHtml(html.slice(0, maxLength), {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "h2", "h3", "h4", "ul", "ol", "li", "a", "blockquote", "hr", "img"],
    // target/rel are only ever the values set below.
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt"] },
    allowedSchemes: ["https", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
      // Pasted or JobAdder HTML: keep its structure in the tags we allow.
      div: "p",
      h1: "h2",
      h5: "h4",
      h6: "h4",
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

// A saved (even empty) panel keeps what was saved; a missing one gets the default.
const richOr = (html: unknown, fallback: string) => cleanRichHtml(typeof html === "string" ? html : fallback);

// Lobby content saved before the tips became rich text had them as a list of lines.
function tipsListHtml(input: unknown): string | undefined {
  const tips = (input as { tips?: unknown } | null | undefined)?.tips;
  if (!Array.isArray(tips)) return undefined;
  const escape = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  return `<ul>${tips.map((t) => `<li>${escape(String(t))}</li>`).join("")}</ul>`;
}

// Turns whatever came in (the editor, or the stored JSON) into safe content.
export function cleanLobby(input: Partial<WaitingRoomContent> | null | undefined): WaitingRoomContent {
  const d = defaultWaitingRoomContent;
  const ctaHref = cleanLink(input?.cta?.href);
  const ctaLabel = input?.cta?.label?.trim().slice(0, LOBBY_LIMITS.ctaLabel);
  return {
    headline: input?.headline?.trim().slice(0, LOBBY_LIMITS.headline) || d.headline,
    bodyHtml: richOr(input?.bodyHtml, d.bodyHtml),
    videoUrl: videoEmbedUrl(input?.videoUrl),
    tipsHtml: richOr(input?.tipsHtml ?? tipsListHtml(input), d.tipsHtml),
    interviewTipsTitle: input?.interviewTipsTitle?.trim().slice(0, LOBBY_LIMITS.title) || d.interviewTipsTitle,
    interviewTipsHtml: richOr(input?.interviewTipsHtml, d.interviewTipsHtml),
    jobLinkLabel: input?.jobLinkLabel?.trim().slice(0, LOBBY_LIMITS.ctaLabel) || d.jobLinkLabel,
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
