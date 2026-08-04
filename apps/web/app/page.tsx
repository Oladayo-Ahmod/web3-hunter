import { Button } from "@web3-hunter/ui";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Web3 Hunter</h1>
        <p className="text-muted-foreground">
          Engineering foundation is live. Product functionality begins in Milestone 1.
        </p>
      </div>
      <Button asChild>
        <Link href="/health">View system health</Link>
      </Button>
    </main>
  );
}
