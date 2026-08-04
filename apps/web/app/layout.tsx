import "@web3-hunter/ui/globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Web3 Hunter",
  description: "AI-powered opportunity intelligence platform for Web3 engineers.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <Link href="/" className="font-semibold">
            Web3 Hunter
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/opportunities" className="text-muted-foreground hover:text-foreground">
              Opportunities
            </Link>
            {/* /profile redirects to /sign-in when not signed in, so the
                layout itself never needs to resolve session state — doing
                so here would force every page, including statically
                generated ones like /_not-found, to require a live
                database/auth configuration at build time. */}
            <Link href="/profile" className="text-muted-foreground hover:text-foreground">
              Account
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
