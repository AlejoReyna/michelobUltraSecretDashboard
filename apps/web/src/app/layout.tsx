import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MapachesBot Trading Agent",
  description: "Read-only operator console for MapachesBot telemetry.",
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
