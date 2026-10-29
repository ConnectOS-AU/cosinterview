"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { WaitingRoomContent } from "@/content/waiting-room";
import { InterviewTipsPanel, LobbyPanel, LobbyTips } from "@/app/(portal)/lobby-panel";
import { previewLobby, resetLobby, saveLobby, type LobbyInput } from "./actions";
import { RichTextEditor } from "./rich-text-editor";

const INPUT = "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none";
const LABEL = "block text-sm font-medium text-neutral-700";
const HTML_HINT = "Headings, bold/italic, lists, quotes, links, images (https) and divider lines. Scripts, styles and embeds are removed when saved.";

function toInput(c: WaitingRoomContent): LobbyInput {
  return {
    headline: c.headline,
    bodyHtml: c.bodyHtml,
    videoUrl: c.videoUrl ?? "",
    tipsHtml: c.tipsHtml,
    interviewTipsTitle: c.interviewTipsTitle,
    interviewTipsHtml: c.interviewTipsHtml,
    jobLinkLabel: c.jobLinkLabel,
    ctaLabel: c.cta?.label ?? "",
    ctaHref: c.cta?.href ?? "",
  };
}

function Panel({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6">
      <div>
        <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
        <p className="text-xs text-neutral-500">{note}</p>
      </div>
      {children}
    </section>
  );
}

// Every panel on the candidate's lobby screen, each with a visual / HTML editor.
// The server cleans whatever comes in, and the preview always shows the cleaned
// version - exactly what candidates will see.
export function LobbyEditor({ initial }: { initial: WaitingRoomContent }) {
  const [input, setInput] = useState<LobbyInput>(() => toInput(initial));
  const [preview, setPreview] = useState<WaitingRoomContent>(initial);
  // Bumped when saved / reset content replaces what's in the editors.
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, startSaving] = useTransition();

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

  // Unsaved changes: ask before leaving.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function apply(content: WaitingRoomContent, text: string) {
    setInput(toInput(content));
    setPreview(content);
    setVersion((v) => v + 1);
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
    if (!window.confirm("Put the whole lobby screen back to the original ConnectOS text? Your changes will be lost.")) return;
    startSaving(async () => {
      const res = await resetLobby();
      if (!res.ok) return setMessage({ ok: false, text: res.error });
      apply(res.content, "Back to the original text.");
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Panel title="Waiting card" note="Beside the recruiter's photo, under the waiting message.">
          <div>
            <label htmlFor="lobby-job-label" className={LABEL}>
              Job description link
            </label>
            <input
              id="lobby-job-label"
              className={`${INPUT} mt-1`}
              maxLength={60}
              value={input.jobLinkLabel}
              onChange={(e) => update({ jobLinkLabel: e.target.value })}
            />
            <p className="mt-1 text-xs text-neutral-500">
              The button&apos;s wording. It opens the job description from JobAdder in a new tab, and only shows when JobAdder has
              one for the candidate&apos;s job.
            </p>
          </div>
          <RichTextEditor
            id="lobby-tips"
            label="Tips while waiting"
            value={input.tipsHtml}
            onChange={(tipsHtml) => update({ tipsHtml })}
            version={version}
            minHeight="min-h-[8rem]"
            extraClass="lobby-tips text-sm"
            hint="A bullet list works best here. Leave it empty to hide the tips."
          />
        </Panel>

        <Panel title="Interview tips" note="Its own panel, under the waiting card.">
          <div>
            <label htmlFor="lobby-interview-title" className={LABEL}>
              Panel title
            </label>
            <input
              id="lobby-interview-title"
              className={`${INPUT} mt-1`}
              maxLength={80}
              value={input.interviewTipsTitle}
              onChange={(e) => update({ interviewTipsTitle: e.target.value })}
            />
          </div>
          <RichTextEditor
            id="lobby-interview-tips"
            label="Content"
            value={input.interviewTipsHtml}
            onChange={(interviewTipsHtml) => update({ interviewTipsHtml })}
            version={version}
            minHeight="min-h-[10rem]"
            extraClass="lobby-tips text-sm"
            hint="Leave it empty to hide this panel."
          />
        </Panel>

        <Panel title="ConnectOS panel" note="The large panel with the photo.">
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
          <RichTextEditor
            id="lobby-body"
            label="Content"
            value={input.bodyHtml}
            onChange={(bodyHtml) => update({ bodyHtml })}
            version={version}
            hint={HTML_HINT}
          />
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
        </Panel>

        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-white/95 p-4 backdrop-blur">
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

      <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Preview - what candidates see</p>
        <div className="space-y-4 rounded-lg bg-brand-bg p-4">
          <div className="space-y-4 rounded-3xl border border-brand-line bg-brand-surface p-5">
            <div>
              <p className="text-sm font-medium text-brand-ink">Thanks, you&apos;re in the waiting room</p>
              <p className="mt-1 text-sm text-brand-muted">Your recruiter will let you in shortly.</p>
            </div>
            <span className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-teal/40 bg-brand-teal-tint px-4 py-2.5 text-sm font-medium text-brand-teal">
              {preview.jobLinkLabel} <span aria-hidden>↗</span>
            </span>
            <LobbyTips html={preview.tipsHtml} />
          </div>
          <InterviewTipsPanel title={preview.interviewTipsTitle} html={preview.interviewTipsHtml} />
          <LobbyPanel content={preview} />
        </div>
      </div>
    </div>
  );
}
