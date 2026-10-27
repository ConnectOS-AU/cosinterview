import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "../globals.css";

// Root layout for candidate-facing pages: connectos.co branding (matches
// connectos-bi-chat). The recruiter screens have their own root layout in (staff).

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// viewportFit "cover" lets safe-area padding clear the notch / home bar on iPhones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F1EA" },
    { media: "(prefers-color-scheme: dark)", color: "#1B1A1C" },
  ],
};

export const metadata: Metadata = {
  title: "ConnectOS Interviews",
  description: "Book and join your interview with ConnectOS.",
  robots: { index: false, follow: false },
};

// Runs before first paint: picks the saved theme (or the device's) so a dark-mode
// visitor never sees a light flash.
const THEME_SCRIPT =
  '(function(){try{var t=localStorage.getItem("cosrec:theme");' +
  'var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);' +
  'document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}})()';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`min-h-screen bg-brand-bg text-brand-text ${poppins.className}`}>{children}</body>
    </html>
  );
}
