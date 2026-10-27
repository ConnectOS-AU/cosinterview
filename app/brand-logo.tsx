// The ConnectOS wordmark: teal in light mode, gold in dark mode. Both images are
// transparent, so they sit straight on the page with no backing. No client code,
// so it works in server pages (login) and client components alike.
//
// The artwork has a little empty margin around the mark, so size it by height and
// nudge it with a negative margin if it needs to line up with text.
export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- static asset in public/ */}
      <img src="/logo-teal.webp" alt="ConnectOS" className={`dark:hidden ${className}`} />
      {/* eslint-disable-next-line @next/next/no-img-element -- static asset in public/ */}
      <img src="/logo-gold.webp" alt="" aria-hidden className={`hidden dark:block ${className}`} />
    </>
  );
}
