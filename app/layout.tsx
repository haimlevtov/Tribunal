import type { Metadata } from "next";
import { Archivo_Narrow, Courier_Prime } from "next/font/google";
import "./globals.css";

/**
 * Two faces, each doing one job.
 *
 * Courier Prime sets the record itself — a transcript typeface, and the
 * reason the page reads as a document rather than a UI. Archivo Narrow
 * handles everything a document sets in type rather than types: the
 * caption, the rubrics, the seat designations, and the verdict stamps.
 *
 * Both are self-hosted by next/font, so there is no third-party request on
 * first paint and no flash of a fallback face.
 */
const record = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-record",
  display: "swap",
});

const caption = Archivo_Narrow({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-caption",
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Tribunal",
  description:
    "Four advocates argue, three judges rule independently, and the decision is left to you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${record.variable} ${caption.variable}`}>
      <body>{children}</body>
    </html>
  );
}
