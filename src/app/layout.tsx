import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";
import { getCurrentSession } from "@/server/session";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const themeInitializer = `
  try {
    if (window.localStorage.getItem("ygo-theme") === "dark") {
      document.documentElement.classList.add("dark-mode");
    }
  } catch (_) {}
`;

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
  const session = await getCurrentSession();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
      </head>
      <body className="min-h-full flex flex-col">
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
