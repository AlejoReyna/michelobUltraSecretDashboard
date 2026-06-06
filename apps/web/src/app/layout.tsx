import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cascade AI Trading Dashboard",
  description: "Industrial trading bot dashboard for crypto operations.",
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
