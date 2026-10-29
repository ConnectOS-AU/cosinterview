import type { ReactNode } from "react";
import { BrandLogo } from "@/app/brand-logo";
import { initials } from "@/lib/format";
import type { PublicRecruiter } from "@/lib/types";

// Layout for every candidate page, following the COSAI login page: a photo panel
// (the recruiter, or the brand photo) beside a raised card. On phones the photo
// becomes a short hero above the card.
export function PortalShell({ recruiter, children }: { recruiter?: PublicRecruiter; children: ReactNode }) {
  const photo = recruiter?.photoUrl ?? "/login-photo.jpg";
  return (
    <main className="relative flex min-h-dvh flex-col bg-brand-bg lg:flex-row">
      <div className="relative h-56 flex-shrink-0 overflow-hidden lg:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- recruiter photo from Supabase Storage or a static asset */}
        <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0C4E60]/95 via-[#0C4E60]/45 to-[#0C4E60]/10" />
        {recruiter && <HeroText recruiter={recruiter} className="absolute inset-x-0 bottom-0 px-6 pb-16" />}
      </div>

      <div className="relative hidden w-5/12 lg:flex">
        {/* eslint-disable-next-line @next/next/no-img-element -- recruiter photo from Supabase Storage or a static asset */}
        <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0C4E60]/95 via-[#0C4E60]/40 to-[#0C4E60]/10" />
        <div className="relative mt-auto p-12">
          {recruiter ? (
            <HeroText recruiter={recruiter} large />
          ) : (
            <h2 className="text-4xl font-semibold leading-tight text-white">Where offshoring meets excellence</h2>
          )}
        </div>
      </div>

      <div className="flex w-full flex-1 flex-col items-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] lg:justify-center lg:px-8 lg:py-10">
        <div className="relative -mt-12 w-full max-w-xl animate-fade-up space-y-6 rounded-3xl border border-brand-line bg-brand-surface p-6 shadow-xl shadow-brand-gold/10 sm:p-10 lg:mt-0">
          <BrandLogo className="-ml-3 h-12 w-auto" />
          {children}
        </div>
        <p className="mt-auto pt-8 text-center text-xs text-brand-faint lg:mt-8 lg:pt-0">
          ConnectOS &middot; Where offshoring meets excellence
        </p>
      </div>
    </main>
  );
}

function HeroText({
  recruiter,
  large = false,
  className = "",
}: {
  recruiter: PublicRecruiter;
  large?: boolean;
  className?: string;
}) {
  return (
    <div className={`text-white ${className}`}>
      <p className="text-sm font-medium uppercase tracking-wider text-white/70">Your recruiter</p>
      <h2 className={`${large ? "text-4xl" : "text-2xl"} font-semibold leading-tight`}>{recruiter.displayName}</h2>
      {recruiter.title && <p className={`${large ? "mt-1 text-lg" : "text-sm"} text-white/80`}>{recruiter.title}</p>}
    </div>
  );
}

export function RecruiterAvatar({ recruiter, size = "h-16 w-16" }: { recruiter: PublicRecruiter; size?: string }) {
  if (recruiter.photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- recruiter photo from Supabase Storage
      <img
        src={recruiter.photoUrl}
        alt={recruiter.displayName}
        className={`${size} flex-shrink-0 rounded-full object-cover ring-2 ring-brand-gold/40`}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={`${size} flex flex-shrink-0 items-center justify-center rounded-full bg-brand-teal-tint text-lg font-semibold text-brand-teal ring-2 ring-brand-gold/40`}
    >
      {initials(recruiter.displayName)}
    </div>
  );
}

export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-medium text-brand-ink sm:text-3xl">{title}</h1>
      <div className="mt-2 space-y-2 text-base text-brand-muted">{children}</div>
    </div>
  );
}
