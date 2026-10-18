import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Outfit } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/shell";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

const plex = IBM_Plex_Mono({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Non_Fraud · Behaviour desk",
  description:
    "A card-fraud desk that scores authorizations against behaviour groups from the Sparkov book. Built for the AI Builder Cup 2026 BFSI theme.",
  icons: { icon: "/mark.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${fraunces.variable} ${plex.variable} dark h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <TooltipProvider>
          <Shell>{children}</Shell>
        </TooltipProvider>
      </body>
    </html>
  );
}
