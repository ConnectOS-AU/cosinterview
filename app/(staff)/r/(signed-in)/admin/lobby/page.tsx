import Link from "next/link";
import { notFound } from "next/navigation";
import { getLobbyContent } from "@/lib/lobby";
import { getStaff } from "@/lib/staff/auth";
import { LobbyEditor } from "./lobby-editor";

export const dynamic = "force-dynamic";

// Admins only: the screen candidates see while they wait to be let in.
export default async function LobbyEditorPage() {
  const staff = await getStaff();
  if (!staff?.own?.isAdmin) notFound();
  const content = await getLobbyContent();

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div>
        <Link href="/r/admin" className="text-xs font-medium text-neutral-500 underline hover:text-neutral-800">
          ← Admin
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-neutral-900">Lobby screen</h1>
        <p className="mt-1 text-sm text-neutral-500">
          What candidates see while they wait for their recruiter to let them in. Changes show for every candidate as soon as you
          save.
        </p>
      </div>
      <LobbyEditor initial={content} />
    </main>
  );
}
