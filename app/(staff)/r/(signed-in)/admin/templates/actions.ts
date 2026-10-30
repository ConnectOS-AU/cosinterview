"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/staff/auth";
import { getTemplateOverrides, saveTemplateOverrides } from "@/lib/template-store";
import {
  DEFAULT_TEMPLATES,
  EMAILS,
  MESSAGES,
  mergeTemplates,
  type EmailTemplate,
  type EmailTemplateId,
  type MessageTemplateId,
  type TemplateOverrides,
  type Templates,
} from "@/lib/templates";

export type TemplateChange =
  | { kind: "email"; id: EmailTemplateId; value: EmailTemplate | null }
  | { kind: "message"; id: MessageTemplateId; value: string | null }
  | { kind: "signature"; value: string | null };

export type SaveTemplateResult = { ok: true; templates: Templates } | { ok: false; error: string };

const same = (a: EmailTemplate, b: EmailTemplate) => a.subject === b.subject && a.body === b.body && a.button === b.button && a.footer === b.footer;

// Saves one template (value null = back to the default). Only templates that
// differ from the defaults are stored, so improved defaults reach the rest.
export async function saveTemplate(change: TemplateChange): Promise<SaveTemplateResult> {
  const { own } = await requireAdmin();
  try {
    const stored: TemplateOverrides = structuredClone(await getTemplateOverrides());
    if (change.kind === "email") {
      if (!(change.id in EMAILS)) return { ok: false, error: "Unknown template." };
      const emails = { ...stored.emails };
      delete emails[change.id];
      if (change.value) {
        const cleaned = mergeTemplates({ emails: { [change.id]: change.value } }).emails[change.id];
        if (!same(cleaned, DEFAULT_TEMPLATES.emails[change.id])) emails[change.id] = cleaned;
      }
      stored.emails = emails;
    } else if (change.kind === "message") {
      if (!(change.id in MESSAGES)) return { ok: false, error: "Unknown template." };
      const messages = { ...stored.messages };
      delete messages[change.id];
      if (change.value) {
        const cleaned = mergeTemplates({ messages: { [change.id]: change.value } }).messages[change.id];
        if (cleaned !== DEFAULT_TEMPLATES.messages[change.id]) messages[change.id] = cleaned;
      }
      stored.messages = messages;
    } else {
      delete stored.signature;
      const cleaned = change.value ? mergeTemplates({ signature: change.value }).signature : null;
      if (cleaned && cleaned !== DEFAULT_TEMPLATES.signature) stored.signature = cleaned;
    }
    await saveTemplateOverrides(stored, own.calendarEmail);
    revalidatePath("/r/admin/templates");
    return { ok: true, templates: mergeTemplates(stored) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Saving failed." };
  }
}
