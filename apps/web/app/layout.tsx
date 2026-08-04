import "@web3-hunter/ui/globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Web3 Hunter",
  description: "AI-powered opportunity intelligence platform for Web3 engineers.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
