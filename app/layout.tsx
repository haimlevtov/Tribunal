import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Tribunal",
  description:
    "Four advocates argue, three judges rule independently, and the decision is left to you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
