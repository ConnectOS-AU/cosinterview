"use client";

import { useState, useTransition } from "react";
import {
  DEFAULT_TEMPLATES,
  EMAILS,
  MESSAGES,
  PLACEHOLDERS,
  SIGNATURE_PLACEHOLDERS,
  TEMPLATE_LIMITS,
  renderEmail,
  renderMessage,
  sampleVars,
  unknownPlaceholders,
  type EmailTemplate,
  type EmailTemplateId,
  type MessageTemplateId,
  type Templates,
} from "@/lib/templates";
import { saveTemplate, type TemplateChange } from "./actions";

type Selection = { kind: "email"; id: EmailTemplateId } | { kind: "message"; id: MessageTemplateId } | { kind: "signature" };
type Field = "subject" | "body" | "button" | "footer" | "text";

const keyOf = (s: Selection) => (s.kind === "signature" ? "signature" : `${s.kind}:${s.id}`);
const EMAIL_IDS = Object.keys(EMAILS) as EmailTemplateId[];
const MESSAGE_IDS = Object.keys(MESSAGES) as MessageTemplateId[];

const INPUT = "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-neutral-500 focus:outline-none";
const LABEL = "text-xs font-medium text-neutral-600";

const sameEmail = (a: EmailTemplate, b: EmailTemplate) => a.subject === b.subject && a.body === b.body && a.button === b.button && a.footer === b.footer;

function isChanged(t: Templates, s: Selection, from: Templates): boolean {
  if (s.kind === "email") return !sameEmail(t.emails[s.id], from.emails[s.id]);
  if (s.kind === "message") return t.messages[s.id] !== from.messages[s.id];
  return t.signature !== from.signature;
}

// Every template in a list on the left; the one chosen on the right with its
// placeholders and a live preview using sample details.
export function TemplateEditor({ initial }: { initial: Templates }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [sel, setSel] = useState<Selection>({ kind: "email", id: "invite" });
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [lastField, setLastField] = useState<Field>("body");

  const dirty = isChanged(draft, sel, saved);
  const custom = isChanged(saved, sel, DEFAULT_TEMPLATES);

  function choose(next: Selection) {
    if (dirty && !confirm("Discard your unsaved changes to this template?")) return;
    setDraft(saved);
    setSel(next);
    setStatus(null);
    setLastField(next.kind === "email" ? "body" : "text");
  }

  function setField(field: Field, value: string) {
    setStatus(null);
    setDraft((d) => {
      if (sel.kind === "email") return { ...d, emails: { ...d.emails, [sel.id]: { ...d.emails[sel.id], [field]: value } } };
      if (sel.kind === "message") return { ...d, messages: { ...d.messages, [sel.id]: value } };
      return { ...d, signature: value };
    });
  }

  function valueOf(field: Field): string {
    if (sel.kind === "email") return draft.emails[sel.id][field as keyof EmailTemplate];
    if (sel.kind === "message") return draft.messages[sel.id];
    return draft.signature;
  }

  // Puts {{name}} at the cursor in the field last typed in.
  function insert(name: string) {
    const field = lastField;
    const el = document.getElementById(`tpl-${field}`) as HTMLInputElement | HTMLTextAreaElement | null;
    const current = valueOf(field);
    const token = `{{${name}}}`;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    setField(field, current.slice(0, start) + token + current.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function save(reset: boolean) {
    if (reset && !confirm("Put this template back to the original wording?")) return;
    const change: TemplateChange =
      sel.kind === "email"
        ? { kind: "email", id: sel.id, value: reset ? null : draft.emails[sel.id] }
        : sel.kind === "message"
          ? { kind: "message", id: sel.id, value: reset ? null : draft.messages[sel.id] }
          : { kind: "signature", value: reset ? null : draft.signature };
    startTransition(async () => {
      const res = await saveTemplate(change);
      if (!res.ok) {
        setStatus({ ok: false, text: res.error });
        return;
      }
      setSaved(res.templates);
      setDraft(res.templates);
      setStatus({ ok: true, text: reset ? "Back to the original wording." : "Saved. Everything sent from now on uses this wording." });
    });
  }

  const placeholders = sel.kind === "email" ? EMAILS[sel.id].placeholders : sel.kind === "message" ? MESSAGES[sel.id].placeholders : SIGNATURE_PLACEHOLDERS;
  const allText = sel.kind === "email" ? Object.values(draft.emails[sel.id]).join("\n") : valueOf("text");
  const unknown = unknownPlaceholders(allText, placeholders);

  const fieldProps = (field: Field) => ({
    id: `tpl-${field}`,
    value: valueOf(field),
    onFocus: () => setLastField(field),
    onChange: (e: { target: { value: string } }) => setField(field, e.target.value),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <nav className="space-y-5 text-sm">
        <NavGroup title="Candidate emails">
          {EMAIL_IDS.filter((id) => EMAILS[id].group === "Candidate emails").map((id) => (
            <NavItem key={id} label={EMAILS[id].label} active={keyOf(sel) === `email:${id}`} custom={isChanged(saved, { kind: "email", id }, DEFAULT_TEMPLATES)} onClick={() => choose({ kind: "email", id })} />
          ))}
        </NavGroup>
        <NavGroup title="Attendee emails">
          {EMAIL_IDS.filter((id) => EMAILS[id].group === "Attendee emails").map((id) => (
            <NavItem key={id} label={EMAILS[id].label} active={keyOf(sel) === `email:${id}`} custom={isChanged(saved, { kind: "email", id }, DEFAULT_TEMPLATES)} onClick={() => choose({ kind: "email", id })} />
          ))}
          <NavItem label="Email signature" active={sel.kind === "signature"} custom={isChanged(saved, { kind: "signature" }, DEFAULT_TEMPLATES)} onClick={() => choose({ kind: "signature" })} />
        </NavGroup>
        <NavGroup title="WhatsApp and Viber">
          {MESSAGE_IDS.map((id) => (
            <NavItem key={id} label={MESSAGES[id].label} active={keyOf(sel) === `message:${id}`} custom={isChanged(saved, { kind: "message", id }, DEFAULT_TEMPLATES)} onClick={() => choose({ kind: "message", id })} />
          ))}
        </NavGroup>
        <p className="text-xs text-neutral-500">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500 align-middle" /> changed from the original
        </p>
      </nav>

      <div className="min-w-0 space-y-5">
        <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">
              {sel.kind === "email" ? EMAILS[sel.id].label : sel.kind === "message" ? `${MESSAGES[sel.id].label} (WhatsApp and Viber)` : "Email signature"}
            </h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              {sel.kind === "email"
                ? `Sent: ${EMAILS[sel.id].sentWhen}`
                : sel.kind === "message"
                  ? `Sent: ${MESSAGES[sel.id].sentWhen} Only to candidates who gave their numbers when booking.`
                  : "Goes at the end of every email, after the small print."}
            </p>
          </div>

          {sel.kind === "email" && (
            <>
              <div className="space-y-1">
                <label className={LABEL}>Subject</label>
                <input {...fieldProps("subject")} maxLength={TEMPLATE_LIMITS.subject} className={INPUT} />
              </div>
              <div className="space-y-1">
                <label className={LABEL}>Message</label>
                <textarea {...fieldProps("body")} rows={10} maxLength={TEMPLATE_LIMITS.body} className={`${INPUT} font-mono text-[13px] leading-relaxed`} />
              </div>
              {EMAILS[sel.id].buttonLink && (
                <div className="space-y-1">
                  <label className={LABEL}>Button label (links to {"{{"}{EMAILS[sel.id].buttonLink}{"}}"}; leave empty for no button)</label>
                  <input {...fieldProps("button")} maxLength={TEMPLATE_LIMITS.button} className={INPUT} />
                </div>
              )}
              <div className="space-y-1">
                <label className={LABEL}>Small print (below the button, in grey)</label>
                <textarea {...fieldProps("footer")} rows={3} maxLength={TEMPLATE_LIMITS.footer} className={`${INPUT} font-mono text-[13px] leading-relaxed`} />
              </div>
            </>
          )}
          {sel.kind !== "email" && (
            <textarea
              {...fieldProps("text")}
              rows={sel.kind === "signature" ? 4 : 6}
              maxLength={sel.kind === "signature" ? TEMPLATE_LIMITS.signature : TEMPLATE_LIMITS.message}
              className={`${INPUT} font-mono text-[13px] leading-relaxed`}
            />
          )}

          <div>
            <p className={LABEL}>Insert a detail (goes where your cursor is)</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {placeholders.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => insert(p)}
                  title={PLACEHOLDERS[p]?.label}
                  className="rounded-full border border-neutral-300 bg-neutral-50 px-2.5 py-0.5 font-mono text-xs text-neutral-700 hover:border-neutral-500 hover:bg-white"
                >
                  {`{{${p}}}`}
                </button>
              ))}
            </div>
            <details className="mt-2 text-xs text-neutral-500">
              <summary className="cursor-pointer">What these are, and formatting</summary>
              <ul className="mt-2 space-y-0.5">
                {placeholders.map((p) => (
                  <li key={p}>
                    <span className="font-mono text-neutral-700">{`{{${p}}}`}</span> - {PLACEHOLDERS[p]?.label}
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                A blank line starts a new paragraph. <span className="font-mono">**bold**</span> makes text bold,{" "}
                <span className="font-mono">[label](link)</span> makes a link, and a line starting <span className="font-mono">## </span> is shown large
                (used for the interview time). Links written out in full are clickable. A line is left out when one of its details
                isn&apos;t available for that email.
              </p>
            </details>
          </div>

          {unknown.length > 0 && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {unknown.map((u) => `{{${u}}}`).join(", ")} {unknown.length === 1 ? "isn't a detail" : "aren't details"} this template can fill - it
              would be left blank. Check the spelling, or pick from the list above.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-4">
            <button
              type="button"
              onClick={() => save(false)}
              disabled={!dirty || pending}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            {dirty && (
              <button type="button" onClick={() => setDraft(saved)} disabled={pending} className="text-sm text-neutral-600 underline hover:text-neutral-900">
                Undo changes
              </button>
            )}
            {custom && !dirty && (
              <button type="button" onClick={() => save(true)} disabled={pending} className="text-sm text-neutral-600 underline hover:text-neutral-900">
                Reset to the original wording
              </button>
            )}
            {status && <p className={`text-sm ${status.ok ? "text-emerald-700" : "text-red-700"}`}>{status.text}</p>}
          </div>
        </section>

        <Preview templates={draft} sel={sel} />
      </div>
    </div>
  );
}

function NavGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function NavItem({ label, active, custom, onClick }: { label: string; active: boolean; custom: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left ${active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}
      >
        {label}
        {custom && <span className="ml-2 h-2 w-2 flex-shrink-0 rounded-full bg-sky-500" aria-label="changed" />}
      </button>
    </li>
  );
}

const SAMPLE_VARS = sampleVars();

const SAMPLE_JD = {
  html: '<hr style="border:none;border-top:1px solid #e4e7eb;margin:28px 0 20px"><p style="font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:0.04em;color:#52606d">Job description - Customer Support Specialist</p><div style="font-size:14px"><p>(The job description from JobAdder goes here.)</p></div>',
  text: "---\n\nJOB DESCRIPTION - CUSTOMER SUPPORT SPECIALIST\n\n(The job description from JobAdder goes here.)",
};

// The email or message with sample details, as the reader would get it.
function Preview({ templates, sel }: { templates: Templates; sel: Selection }) {
  const [plain, setPlain] = useState(false);
  const vars = SAMPLE_VARS;
  if (sel.kind === "message") {
    const text = renderMessage(templates.messages[sel.id], vars);
    const oneLine = text.replace(/\s*\n+\s*/g, " - ").replace(/\s{2,}/g, " ");
    return (
      <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-neutral-900">Preview, with sample details</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Bubble title="Viber" text={text} />
          <Bubble title="WhatsApp (sent as one line - WhatsApp doesn't allow line breaks here)" text={oneLine} />
        </div>
      </section>
    );
  }
  const id: EmailTemplateId = sel.kind === "email" ? sel.id : "invite";
  const email = renderEmail(templates, id, vars, id === "guestInvite" ? SAMPLE_JD : undefined);
  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-900">
          Preview, with sample details{sel.kind === "signature" && " (shown on the interview invitation)"}
        </h3>
        <div className="flex rounded-md border border-neutral-300 text-xs">
          <button type="button" onClick={() => setPlain(false)} className={`px-2.5 py-1 ${!plain ? "bg-neutral-900 text-white" : "text-neutral-700"}`}>
            Email
          </button>
          <button type="button" onClick={() => setPlain(true)} className={`px-2.5 py-1 ${plain ? "bg-neutral-900 text-white" : "text-neutral-700"}`}>
            Plain text
          </button>
        </div>
      </div>
      <p className="text-sm">
        <span className="text-neutral-500">Subject:</span> <span className="font-medium text-neutral-900">{email.subject}</span>
      </p>
      {plain ? (
        <pre className="whitespace-pre-wrap rounded-md bg-neutral-50 p-4 font-sans text-sm text-neutral-800">{email.text}</pre>
      ) : (
        <iframe
          title="Email preview"
          sandbox=""
          srcDoc={`<!doctype html><html><body style="margin:16px;background:#fff">${email.bodyHtml}</body></html>`}
          className="h-[34rem] w-full rounded-md border border-neutral-200"
        />
      )}
      <p className="text-xs text-neutral-500">The plain-text version is what email apps without HTML show, and what goes into the candidate&apos;s JobAdder note.</p>
    </section>
  );
}

function Bubble({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-neutral-500">{title}</p>
      <div className="rounded-lg bg-[#e7f6e7] p-3">
        <p className="whitespace-pre-wrap break-words rounded-md bg-white px-3 py-2 text-sm text-neutral-800 shadow-sm">{text}</p>
      </div>
    </div>
  );
}
