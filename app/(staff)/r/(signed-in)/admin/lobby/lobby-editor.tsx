"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { WaitingRoomContent } from "@/content/waiting-room";
import { LobbyPanel, LobbyTips } from "@/app/(portal)/lobby-panel";
import { previewLobby, resetLobby, saveLobby, type LobbyInput } from "./actions";

const INPUT = "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";
const LABEL = "block text-sm font-medium text-neutral-700";
// The visual editor's toolbar: browser editing commands, plus link and image
// (which ask for an address first).
type Tool = { label: string; title: string; cmd: string; value?: string };
const TOOLS: Tool[] = [
  { label: "B", title: "Bold", cmd: "bold" },
  { label: "I", title: "Italic", cmd: "italic" },
  { label: "U", title: "Underline", cmd: "underline" },
  { label: "Heading", title: "Large heading", cmd: "formatBlock", value: "<h2>" },
  { label: "Subheading", title: "Small heading", cmd: "formatBlock", value: "<h3>" },
  { label: "Text", title: "Normal paragraph", cmd: "formatBlock", value: "<p>" },
  { label: "• List", title: "Bullet list", cmd: "insertUnorderedList" },
  { label: "1. List", title: "Numbered list", cmd: "insertOrderedList" },
  { label: "Quote", title: "Quote", cmd: "formatBlock", value: "<blockquote>" },
  { label: "Link", title: "Add a link to the selected text", cmd: "link" },
  { label: "Image", title: "Insert an image from a web address", cmd: "image" },
  { label: "Line", title: "Divider line", cmd: "insertHorizontalRule" },
  { label: "Clear", title: "Remove formatting from the selection", cmd: "removeFormat" },
];
const TOOL =
  "rounded px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-200 disabled:opacity-40 disabled:hover:bg-transparent";

function toInput(c: WaitingRoomContent): LobbyInput {
  return {
    headline: c.headline,
    bodyHtml: c.bodyHtml,
    videoUrl: c.videoUrl ?? "",
    tips: c.tips.join("\n"),
    ctaLabel: c.cta?.label ?? "",
    ctaHref: c.cta?.href ?? "",
  };
}

// Visual (formatted) editing uses the browser's built-in editing commands; the
// HTML tab edits the source. The server cleans whatever comes in, and the
// preview always shows the cleaned version - exactly what candidates will see.
export function LobbyEditor({ initial }: { initial: WaitingRoomContent }) {
  const [input, setInput] = useState<LobbyInput>(() => toInput(initial));
  const [preview, setPreview] = useState<WaitingRoomContent>(initial);
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, startSaving] = useTransition();
  const visual = useRef<HTMLDivElement>(null);

  const update = (fields: Partial<LobbyInput>) => {
    setInput((prev) => ({ ...prev, ...fields }));
    setDirty(true);
    setMessage(null);
  };

  // Live preview, cleaned on the server, a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(() => {
      previewLobby(input).then(setPreview, () => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [input]);

  // The visual editor holds its own DOM; fill it with the cleaned HTML whenever
  // it's shown (on load, and when coming back from the HTML tab).
  useEffect(() => {
    if (mode !== "visual" || !visual.current) return;
    let cancelled = false;
    previewLobby(input).then((clean) => {
      if (!cancelled && visual.current) visual.current.innerHTML = clean.bodyHtml;
    });
    return () => {
      cancelled = true;
    };
    // Only when switching tabs - not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Unsaved changes: ask before leaving.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const fromVisual = () => update({ bodyHtml: visual.current?.innerHTML ?? "" });

  function command(name: string, value?: string) {
    visual.current?.focus();
    document.execCommand(name, false, value);
    fromVisual();
  }

  function addLink() {
    const href = window.prompt("Link address (https://…)", "https://");
    if (href && /^https:\/\/\S+$/i.test(href)) command("createLink", href);
    else if (href) window.alert("Links need to start with https://");
  }

  function addImage() {
    const src = window.prompt("Image address (https://…). Upload it somewhere public first, e.g. the ConnectOS website.", "https://");
    if (src && /^https:\/\/\S+$/i.test(src)) command("insertImage", src);
    else if (src) window.alert("Images need an https:// address.");
  }

  function apply(content: WaitingRoomContent, text: string) {
    setInput(toInput(content));
    setPreview(content);
    if (visual.current) visual.current.innerHTML = content.bodyHtml;
    setDirty(false);
    setMessage({ ok: true, text });
  }

  function save() {
    startSaving(async () => {
      const res = await saveLobby(input);
      if (!res.ok) return setMessage({ ok: false, text: res.error });
      apply(res.content, ["Saved - candidates see this now.", ...res.warnings].join(" "));
    });
  }

  function reset() {
    if (!window.confirm("Put the lobby screen back to the original ConnectOS text? Your changes will be lost.")) return;
    startSaving(async () => {
      const res = await resetLobby();
      if (!res.ok) return setMessage({ ok: false, text: res.error });
      apply(res.content, "Back to the original text.");
    });
  }

  function runTool(tool: Tool) {
    if (tool.cmd === "link") addLink();
    else if (tool.cmd === "image") addImage();
    else command(tool.cmd, tool.value);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5 rounded-lg border border-neutral-200 bg-white p-6">
        <div>
          <label htmlFor="lobby-headline" className={LABEL}>
            Headline
          </label>
          <input
            id="lobby-headline"
            className={`${INPUT} mt-1`}
            maxLength={120}
            value={input.headline}
            onChange={(e) => update({ headline: e.target.value })}
          />
        </div>

        <div>
          <div className="flex items-end justify-between">
            <span className={LABEL}>Content</span>
            <div className="flex rounded-md border border-neutral-300 text-xs" role="tablist">
              {(["visual", "html"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1 font-medium ${mode === m ? "bg-neutral-800 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
                >
                  {m === "visual" ? "Visual" : "HTML"}
                </button>
              ))}
            </div>
          </div>
          {mode === "visual" ? (
            <div className="mt-1 overflow-hidden rounded-md border border-neutral-300">
              <div className="flex flex-wrap gap-0.5 border-b border-neutral-200 bg-neutral-50 p-1">
                {TOOLS.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    title={t.title}
                    // Keep the text selection in the editor when a button is pressed.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => runTool(t)}
                    className={TOOL}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div
                ref={visual}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline
                aria-label="Lobby content"
                onInput={fromVisual}
                onBlur={fromVisual}
                className="lobby-html min-h-[16rem] bg-white p-4 focus:outline-none"
              />
            </div>
          ) : (
            <textarea
              aria-label="Lobby content HTML"
              className={`${INPUT} mt-1 min-h-[19rem] font-mono text-xs`}
              spellCheck={false}
              value={input.bodyHtml}
              onChange={(e) => update({ bodyHtml: e.target.value })}
            />
          )}
          <p className="mt-1 text-xs text-neutral-500">
            Headings, bold/italic, lists, quotes, links, images (https) and divider lines. Anything else - scripts, styles,
            embeds - is removed when saved.
          </p>
        </div>

        <div>
          <label htmlFor="lobby-video" className={LABEL}>
            Video (optional)
          </label>
          <input
            id="lobby-video"
            className={`${INPUT} mt-1`}
            placeholder="https://www.youtube.com/watch?v=…"
            value={input.videoUrl}
            onChange={(e) => update({ videoUrl: e.target.value })}
          />
          <p className="mt-1 text-xs text-neutral-500">A YouTube or Vimeo link. Shown below the content.</p>
        </div>

        <div>
          <label htmlFor="lobby-tips" className={LABEL}>
            Tips while waiting
          </label>
          <textarea
            id="lobby-tips"
            className={`${INPUT} mt-1 min-h-[6rem]`}
            value={input.tips}
            onChange={(e) => update({ tips: e.target.value })}
          />
          <p className="mt-1 text-xs text-neutral-500">One per line (up to 8). Shown beside the recruiter&apos;s photo.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="lobby-cta-label" className={LABEL}>
              Button label (optional)
            </label>
            <input
              id="lobby-cta-label"
              className={`${INPUT} mt-1`}
              maxLength={60}
              value={input.ctaLabel}
              onChange={(e) => update({ ctaLabel: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="lobby-cta-href" className={LABEL}>
              Button link
            </label>
            <input
              id="lobby-cta-href"
              className={`${INPUT} mt-1`}
              placeholder="https://connectos.co"
              value={input.ctaHref}
              onChange={(e) => update({ ctaHref: e.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-4">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={saving}
            className="text-sm font-medium text-neutral-600 underline hover:text-neutral-900 disabled:opacity-50"
          >
            Reset to default
          </button>
          {dirty && !message && <span className="text-xs text-amber-700">Unsaved changes</span>}
          {message && (
            <span role="status" className={`text-sm ${message.ok ? "text-green-700" : "text-red-600"}`}>
              {message.text}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Preview - what candidates see</p>
        <div className="space-y-4 rounded-lg bg-brand-bg p-4">
          <div className="rounded-3xl border border-brand-line bg-brand-surface p-5">
            <p className="text-sm font-medium text-brand-ink">Thanks, you&apos;re in the waiting room</p>
            <p className="mt-1 text-sm text-brand-muted">Your recruiter will let you in shortly.</p>
            <div className="mt-4">
              <LobbyTips tips={preview.tips} />
            </div>
          </div>
          <LobbyPanel content={preview} />
        </div>
      </div>
    </div>
  );
}
