import type { Metadata, Viewport } from 'next'
import type { CSSProperties } from 'react'
import { connection } from 'next/server'
import { Cormorant_Garamond, Geist, Geist_Mono, Noto_Serif_SC } from "next/font/google";
import MobileShell from "./components/MobileShell";
import ServiceWorkerRegister from "./components/ServiceWorkerRegister";
import { AppearanceProvider } from "./components/AppearanceProvider";
import RainLayer from "./components/RainLayer";
import { appearanceHtmlStyle } from "./lib/appearance";
import { loadAppearance } from "./lib/havenAppearance";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  preload: false,
});

const notoSerifSc = Noto_Serif_SC({
  variable: "--font-noto-serif-sc",
  weight: ["400", "600"],
  preload: false,
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection()
  const { appearance, fromHaven } = await loadAppearance()
  return (
    <html
      lang="zh"
      className={`${geistSans.variable} ${geistMono.variable} ${cormorant.variable} ${notoSerifSc.variable} h-full antialiased`}
      data-theme={appearance.theme}
      data-font={appearance.font.display}
      data-rain={appearance.effects.rain.mode}
      data-background={appearance.background.kind}
      style={appearanceHtmlStyle(appearance) as CSSProperties}
    >
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        <AppearanceProvider initial={appearance} initialFromHaven={fromHaven}>
          <RainLayer />
          <MobileShell>{children}</MobileShell>
        </AppearanceProvider>
      </body>
    </html>
  );
}
