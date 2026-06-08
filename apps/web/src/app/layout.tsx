import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "NoNamedYetBot",
  description: "Industrial trading bot dashboard for crypto operations.",
  icons: {
    icon: [{ url: "/raccoon.png", type: "image/png" }],
    shortcut: "/raccoon.png",
    apple: "/raccoon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="min-h-dvh">
      <body className="flex min-h-dvh flex-col">
        <div className="flex min-h-dvh flex-1 flex-col">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
}
