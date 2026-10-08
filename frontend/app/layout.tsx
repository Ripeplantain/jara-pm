import type { Metadata, Viewport } from "next";
import { ThemeScript } from "@/app/theme-script";
import "./globals.css";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before the first paint; see components/shell/theme-toggle. */}
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
