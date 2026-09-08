import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "LeadScope · Agency workspace",
  description: "Evidence-led discovery and review for your agency.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
