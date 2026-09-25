import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter, JetBrains_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono", display: "swap" });
const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Console", template: "%s · Satelink Console" },
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Dark by default; light is a per-browser preference (cookie, not an account setting).
  const theme = (await cookies()).get("slc_theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="en" data-theme={theme} className={`${inter.variable} ${mono.variable} ${serif.variable}`}>
      <body className="min-h-screen text-[13px]">{children}</body>
    </html>
  );
}
