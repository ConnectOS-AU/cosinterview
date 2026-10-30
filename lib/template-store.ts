import "server-only";
import { demoMode } from "./demo";
import { supabaseAdmin } from "./supabase/admin";
import { DEFAULT_TEMPLATES, mergeTemplates, type TemplateOverrides, type Templates } from "./templates";

// The email and WhatsApp/Viber templates admins edit at /r/admin/templates,
// stored in cos_recruitment_settings (key 'templates') as only what was
// changed from the defaults in lib/templates.ts. Read for every email, so held
// for a minute (reminders send several at once).

const KEY = "templates";
const CACHE_MS = 60_000;
const store = globalThis as typeof globalThis & {
  __cosrecTemplates?: TemplateOverrides;
  __cosrecTemplateCache?: { at: number; overrides: TemplateOverrides };
};

export async function getTemplateOverrides(): Promise<TemplateOverrides> {
  if (demoMode()) return store.__cosrecTemplates ?? {};
  const cached = store.__cosrecTemplateCache;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.overrides;
  const { data, error } = await supabaseAdmin().from("cos_recruitment_settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const overrides = (data?.value as TemplateOverrides | undefined) ?? {};
  store.__cosrecTemplateCache = { at: Date.now(), overrides };
  return overrides;
}

// The templates to send with. Emails still go out (with the defaults) if the
// settings can't be read.
export async function getTemplates(): Promise<Templates> {
  try {
    return mergeTemplates(await getTemplateOverrides());
  } catch (err) {
    console.error("[templates] Loading the templates failed - using the defaults", err);
    return DEFAULT_TEMPLATES;
  }
}

export async function saveTemplateOverrides(overrides: TemplateOverrides, updatedBy: string): Promise<void> {
  if (demoMode()) {
    store.__cosrecTemplates = overrides;
    return;
  }
  const { error } = await supabaseAdmin()
    .from("cos_recruitment_settings")
    .upsert({ key: KEY, value: overrides, updated_at: new Date().toISOString(), updated_by: updatedBy });
  if (error) throw new Error(`Saving the templates failed: ${error.message}`);
  store.__cosrecTemplateCache = { at: Date.now(), overrides };
}
