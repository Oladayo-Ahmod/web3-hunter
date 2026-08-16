import { Button } from "@web3-hunter/ui";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-[calc(100vh-57px)] flex-col items-center justify-center gap-8 px-6 text-center">
      <div className="space-y-3">
        <p className="text-sm font-medium text-primary">Your Web3 job search, sorted</p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Who to apply to and DM today
        </h1>
        <p className="mx-auto max-w-xl text-balance text-muted-foreground">
          A curated pool of Web3-native startups, filtered to roles that actually fit a
          smart-contract/protocol/security background — with the founders, CTOs, and security leads
          worth a direct message.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button asChild size="lg">
          <Link href="/today">What To Do Today</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/outreach">Browse Outreach</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/jobs">Browse Jobs</Link>
        </Button>
        <Button asChild variant="ghost" size="lg">
          <Link href="/sign-up">Create your Profile</Link>
        </Button>
      </div>
    </main>
  );
}
