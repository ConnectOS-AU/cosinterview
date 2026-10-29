"use client";

import { useEffect, useRef, useState } from "react";
import { cleanPanelHtml } from "./actions";

const TOOL =
  "rounded px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-200 disabled:opacity-40 disabled:hover:bg-transparent";

// Toolbar: browser editing commands, plus link and image (which ask for an
// address first).
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

// One panel's content: a Visual tab (formatted editing) and an HTML tab (the
// source). Whatever goes in is cleaned on the server before it's saved or shown
// to candidates; the visual editor is only ever loaded with cleaned HTML.
// `version` changes when the parent replaces the content (save, reset).
export function RichTextEditor({
  id,
  label,
  hint,
  value,
  onChange,
  version,
  minHeight = "min-h-[16rem]",
  extraClass = "",
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (html: string) => void;
  version: number;
  minHeight?: string;
  extraClass?: string;
}) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const visual = useRef<HTMLDivElement>(null);

  // Fill the visual editor when it's shown, and when the content is replaced.
  useEffect(() => {
    if (mode !== "visual" || !visual.current) return;
    let cancelled = false;
    cleanPanelHtml(value).then((clean) => {
      if (!cancelled && visual.current) visual.current.innerHTML = clean;
    });
    return () => {
      cancelled = true;
    };
    // Not on every keystroke - only on tab switches and replacements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, version]);

  const fromVisual = () => onChange(visual.current?.innerHTML ?? "");

  function command(name: string, arg?: string) {
    visual.current?.focus();
    document.execCommand(name, false, arg);
    fromVisual();
  }

  function runTool(tool: Tool) {
    if (tool.cmd === "link") {
      const href = window.prompt("Link address (https://…)", "https://");
      if (href && /^https:\/\/\S+$/i.test(href)) command("createLink", href);
      else if (href) window.alert("Links need to start with https://");
    } else if (tool.cmd === "image") {
      const src = window.prompt("Image address (https://…). Upload it somewhere public first, e.g. the ConnectOS website.", "https://");
      if (src && /^https:\/\/\S+$/i.test(src)) command("insertImage", src);
      else if (src) window.alert("Images need an https:// address.");
    } else {
      command(tool.cmd, tool.value);
    }
  }

  return (
    <div>
      <div className="flex items-end justify-between">
        <span id={`${id}-label`} className="block text-sm font-medium text-neutral-700">
          {label}
        </span>
        <div className="flex rounded-md border border-neutral-300 text-xs" role="tablist" aria-label={`${label} editor`}>
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
            aria-labelledby={`${id}-label`}
            onInput={fromVisual}
            onBlur={fromVisual}
            className={`lobby-html ${extraClass} ${minHeight} bg-white p-4 focus:outline-none`}
          />
        </div>
      ) : (
        <textarea
          aria-labelledby={`${id}-label`}
          className={`mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-xs focus:border-neutral-500 focus:outline-none ${minHeight}`}
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}
