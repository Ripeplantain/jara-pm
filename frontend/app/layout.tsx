import type { Metadata, Viewport } from "next";
import { Fraunces, Inter_Tight } from "next/font/google";
import { ThemeScript } from "@/app/theme-script";
import "./globals.css";

// Self-hosted by next/font at build time, so the browser never calls a font CDN.
//
// Fraunces carries the brand voice on headings; its SOFT and WONK axes are what make it
// characterful rather than another neutral serif, and they are set in globals.css.
const display = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  axes: ["SOFT", "WONK", "opsz"],
});

// Inter Tight carries every control, label and card face, where legibility at ~13px matters
// more than personality.
const sans = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: { default: "Kobi", template: "%s · Kobi" },
  description: "Product management with shared boards, sprints and an AI assistant",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the saved theme before the first paint; see components/shell/theme-toggle. */}
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
