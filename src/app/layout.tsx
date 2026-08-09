import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import { AppInit } from "@/components/app-init";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Yu-Gi-Oh! Collection Hub",
  description: "A personal Yu-Gi-Oh! Library, wishlist, inventory, and records hub.",
};

export const viewport: Viewport = {
  initialScale: 1,
  width: "device-width",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = process.env.RECORDS_BROWSER_TEST === "1"
    ? null
    : await (await import("@/server/session")).getCurrentSession();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head />
      <body className="min-h-full flex flex-col">
        <AppInit
          loadGrabScript={
            process.env.NODE_ENV === "development" &&
            process.env.RECORDS_BROWSER_TEST !== "1"
          }
        />
        <Providers
          initialAuth={{
            isAuthenticated: Boolean(session),
            role: session?.user.role ?? null,
          }}
        >
          {children}
        </Providers>
      </body>
    </html>
  );
}
