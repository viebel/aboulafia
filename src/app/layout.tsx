import { SiteHeader } from "@/components/site-header";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Metadata } from "next";
import localFont from "next/font/local";
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

const mystic = localFont({
  variable: "--font-mystic",
  src: "../../public/fonts/Macondo-Regular.ttf",
  weight: "400",
});

const hebrew = localFont({
  variable: "--font-hebrew",
  src: "../../public/fonts/ShlomoStam.ttf",
  weight: "400",
});

export const metadata: Metadata = {
  title: {
    default: "Aboulafia — the path through the pancake graph",
    template: "%s · Aboulafia",
  },
  description:
    "Visualization of graph generators: pancake, star, permutohedron, transposition, cyclic adjacent, and hypercube.",
  metadataBase: new URL("https://aboulafia.vercel.app"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${mystic.variable} ${hebrew.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground min-h-full flex flex-col">
        <TooltipProvider delayDuration={150}>
          <SiteHeader />
          <main className="flex-1">{children}</main>
        </TooltipProvider>
      </body>
    </html>
  );
}
