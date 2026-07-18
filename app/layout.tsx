import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from "next/font/google";
import MobileShell from "./components/MobileShell";
import ServiceWorkerRegister from "./components/ServiceWorkerRegister";
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
  title: "小言&小羊的家",
  description: "New Ombre Brain",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "小言&小羊的家",
    statusBarStyle: "black-translucent",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        <MobileShell>{children}</MobileShell>
      </body>
    </html>
  );
}
