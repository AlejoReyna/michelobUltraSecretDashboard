import type { Metadata } from "next";
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
