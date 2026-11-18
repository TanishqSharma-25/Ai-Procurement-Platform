import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Corvo Procurement · Policy-Driven PR-to-PO",
  description: "Policy-as-data PR-to-PO decision engine and buyer workspace for Corvo Engineering",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
