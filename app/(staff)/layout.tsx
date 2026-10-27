import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "../globals.css";

// Root layout for the recruiter screens, shown inside COSHub's content pane.
// Styled like COScomms: COSHub already draws the ConnectOS branding around
// it, so this is plain neutral UI with no logo.

const geist = Geist({ subsets: ["latin"] });

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export const metadata: Metadata = {
  title: "Interviews",
  robots: { index: false, follow: false },
};

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`min-h-screen bg-neutral-50 text-neutral-900 antialiased ${geist.className}`}>{children}</body>
    </html>
  );
}
