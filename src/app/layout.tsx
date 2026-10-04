import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, VT323 } from "next/font/google";
import { EasterEggs } from "@/components/EasterEggs";
import { MatrixRain } from "@/components/MatrixRain";
import { SettingsProvider, Toasts } from "@/components/Settings";
import { BRAND } from "@/lib/brand";
import "./globals.css";

const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
const display = VT323({ subsets: ["latin"], weight: "400", variable: "--font-vt323", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(BRAND.url),
  title: { default: `${BRAND.name} — programming languages, head to head`, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  openGraph: { type: "website", siteName: "Clash of Langs", url: "/", title: "Clash of Langs — which programming language wins?", description: "24 languages race on real runtimes across 11 real-world challenges, with every result verified bit-identical. Free and open source." },
  twitter: { card: "summary_large_image", title: "Clash of Langs — which programming language wins?" },
};

export const viewport: Viewport = {
  themeColor: "#010302",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${display.variable}`}>
      <body>
        <SettingsProvider>
          <MatrixRain />
          <div className="crt" aria-hidden="true" />
          <div className="crt-sweep" aria-hidden="true" />
          {children}
          <Toasts />
          <EasterEggs />
        </SettingsProvider>
      </body>
    </html>
  );
}
