import { redirect } from "next/navigation";
import { getStaff } from "@/lib/staff/auth";
import { safeNextPath } from "@/lib/staff/session";
import { SignInButton } from "./sign-in-button";

export const metadata = { title: "Sign in · COSInterview" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ error?: string; next?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { error, next } = await searchParams;
  const nextPath = safeNextPath(next);
  if (await getStaff()) redirect(nextPath);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5 rounded-lg border border-neutral-200 bg-white px-8 py-10 text-center">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Sign in to Interviews</h1>
          <p className="mt-1 text-sm text-neutral-500">Use your ConnectOS Microsoft account.</p>
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <SignInButton next={nextPath} />
      </div>
    </div>
  );
}
