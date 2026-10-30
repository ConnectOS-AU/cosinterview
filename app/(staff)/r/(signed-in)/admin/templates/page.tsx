import Link from "next/link";
import { notFound } from "next/navigation";
import { getStaff } from "@/lib/staff/auth";
import { getTemplates } from "@/lib/template-store";
import { TemplateEditor } from "./template-editor";

export const dynamic = "force-dynamic";

// Admins only: the wording of every email and WhatsApp/Viber message the
// system sends to candidates and attendees.
export default async function TemplatesPage() {
  const staff = await getStaff();
  if (!staff?.own?.isAdmin) notFound();
  const templates = await getTemplates();

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div>
        <Link href="/r/admin" className="text-xs font-medium text-neutral-500 underline hover:text-neutral-800">
          ← Admin
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900">Emails and messages</h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-500">
          The wording of every email and WhatsApp/Viber message sent to candidates and interview attendees. Changes apply to
          everything sent after you save. Emails go out in the recruiter&apos;s name.
        </p>
      </div>
      <TemplateEditor initial={templates} />
    </main>
  );
}
