import { BrandLogo } from "./brand-logo";

// Placeholder home page. Candidates always arrive on their own invite link
// (/c/<recruiter>/<token>), so the bare domain only needs to say where they are.
export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6 animate-fade-up rounded-3xl border border-brand-line bg-brand-surface p-6 shadow-xl shadow-brand-gold/10 sm:p-10">
        <BrandLogo className="-ml-3 h-14 w-auto" />
        <div>
          <h1 className="text-3xl font-medium text-brand-ink">ConnectOS Interviews</h1>
          <p className="mt-2 text-base text-brand-muted">
            To book or join your interview, open the link in the invitation email from your
            ConnectOS recruiter.
          </p>
        </div>
      </div>
      <p className="mt-8 text-center text-xs text-brand-faint">
        ConnectOS &middot; Where offshoring meets excellence
      </p>
    </main>
  );
}
