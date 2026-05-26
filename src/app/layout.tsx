import { SiteHeader } from "@/components/site-header";
import { TooltipProvider } from "@/components/ui/tooltip";
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
  title: {
    default: "Aboulafia — the path through the pancake graph",
    template: "%s · Aboulafia",
  },
  description:
    "Visualization of graph generators: pancake, star, permutohedron, cyclic adjacent, and hypercube.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
