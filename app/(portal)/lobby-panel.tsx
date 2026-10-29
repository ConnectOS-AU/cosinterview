import type { WaitingRoomContent } from "@/content/waiting-room";

// The ConnectOS panel candidates see while they wait. Shared by the interview
// room and the admin editor's preview. bodyHtml is already sanitised (lib/lobby.ts).
export function LobbyPanel({ content: c }: { content: WaitingRoomContent }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-brand-line bg-brand-surface shadow-card animate-fade-up">
      <div className="relative h-40 sm:h-52">
        {/* eslint-disable-next-line @next/next/no-img-element -- static asset in public/ */}
        <img src="/login-photo.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0C4E60]/90 via-[#0C4E60]/40 to-[#0C4E60]/10" />
        <h2 className="absolute inset-x-0 bottom-0 p-6 text-2xl font-semibold text-white sm:text-3xl">{c.headline}</h2>
      </div>
      <div className="space-y-6 p-6 sm:p-8">
        {c.bodyHtml && <div className="lobby-html" dangerouslySetInnerHTML={{ __html: c.bodyHtml }} />}
        {c.videoUrl && (
          <div className="aspect-video overflow-hidden rounded-2xl bg-brand-sunken">
            <iframe
              src={c.videoUrl}
              title="About ConnectOS"
              className="h-full w-full"
              allow="encrypted-media; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}
        {c.cta && (
          <a
            href={c.cta.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-xl border border-brand-gold/50 bg-brand-gold-tint px-4 py-2.5 text-sm font-medium text-brand-gold-dark transition hover:bg-brand-gold/20"
          >
            {c.cta.label}
          </a>
        )}
      </div>
    </section>
  );
}

// Tips beside the recruiter's photo while the candidate waits.
export function LobbyTips({ html }: { html: string }) {
  if (!html) return null;
  return (
    <div className="lobby-html lobby-tips border-t border-brand-line pt-4 text-sm" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

// Its own panel under the waiting card.
export function InterviewTipsPanel({ title, html }: { title: string; html: string }) {
  if (!html) return null;
  return (
    <section className="space-y-3 rounded-3xl border border-brand-line bg-brand-surface p-6 shadow-card animate-fade-up sm:p-8">
      <h2 className="text-lg font-medium text-brand-ink">{title}</h2>
      <div className="lobby-html lobby-tips text-sm" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
