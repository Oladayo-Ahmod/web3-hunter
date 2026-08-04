import { Button } from "@web3-hunter/ui";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Web3 Hunter</h1>
        <p className="text-muted-foreground">
          Explainable, deterministic hiring-intent Opportunities for Web3 engineers.
        </p>
      </div>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/opportunities">Browse Opportunities</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/health">View system health</Link>
        </Button>
      </div>
    </main>
  );
}
