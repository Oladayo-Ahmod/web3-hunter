import "@web3-hunter/ui/globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Web3 Hunter",
  description: "A personal Web3 career-intelligence tool: who to apply to and DM today.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/85 px-6 py-3 backdrop-blur-sm">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block size-2 rounded-full bg-primary" />
            Web3 Hunter
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/today"
              className="rounded-md px-3 py-1.5 font-medium text-foreground hover:bg-accent"
            >
              Today
            </Link>
            <Link
              href="/outreach"
              className="rounded-md px-3 py-1.5 font-medium text-foreground hover:bg-accent"
            >
              Outreach
            </Link>
            <Link
              href="/jobs"
              className="rounded-md px-3 py-1.5 font-medium text-foreground hover:bg-accent"
            >
              Jobs
            </Link>
            <span className="mx-1 h-4 w-px bg-border" />
            <Link
              href="/opportunities"
              className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Opportunities
            </Link>
            <Link
              href="/recommendations"
              className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Recommendations
            </Link>
            {/* /profile and /recommendations redirect to /sign-in when not
                signed in, so the layout itself never needs to resolve
                session state — doing so here would force every page,
                including statically generated ones like /_not-found, to
                require a live database/auth configuration at build time. */}
            <Link
              href="/profile"
              className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Account
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
