import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cascade AI Trading Agent",
  description: "Read-only operator console for Cascade AI telemetry.",
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
