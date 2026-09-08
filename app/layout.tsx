import type { Metadata } from "next";
import { Archivo_Narrow, Courier_Prime } from "next/font/google";
import ThemeToggle from "./theme-toggle";
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

/**
 * Applies the remembered theme before the first paint.
 *
 * Without this the page renders light, then React reads localStorage and flips
 * to dark — a visible flash on every load for anyone who chose dark. It runs
 * before the body exists, so there is nothing to flash. The OS preference is
 * deliberately ignored: the record opens on paper unless the reader has said
 * otherwise on this device.
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("tribunal-theme");document.documentElement.setAttribute("data-theme",t==="dark"?"dark":"light")}catch(e){document.documentElement.setAttribute("data-theme","light")}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${record.variable} ${caption.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
