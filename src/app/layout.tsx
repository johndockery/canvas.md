import type { Metadata } from "next";
import { Source_Serif_4, Inter, Inter_Tight } from "next/font/google";
import SessionProvider from "@/components/SessionProvider";
import "./globals.css";

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-section",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Canvas",
  description: "Collaborative markdown editor with AI agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${sourceSerif.variable} ${inter.variable} ${interTight.variable}`}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
