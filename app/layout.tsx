import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  manifest: "/manifest.json",               // ← 添加 manifest
  appleWebApp: {
    capable: true,
    title: "小言&小羊的家",                 // ← apple-mobile-web-app-title
    statusBarStyle: "black-translucent",   // ← 状态栏样式
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",                  // ← 覆盖全屏（刘海屏适配）
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
