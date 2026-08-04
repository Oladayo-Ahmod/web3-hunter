import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@web3-hunter/ui";
import type { Metadata } from "next";
import { checkDatabaseHealth } from "@/lib/health";

// See app/api/health/route.ts: this page must never be statically generated.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "System Health — Web3 Hunter",
};

export default async function HealthPage() {
  const result = await checkDatabaseHealth();

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>System Health</CardTitle>
            <Badge variant={result.status === "ok" ? "default" : "destructive"}>
              {result.status === "ok" ? "Operational" : "Degraded"}
            </Badge>
          </div>
          <CardDescription>Live connectivity check: Next.js → Drizzle → Postgres.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {result.status === "ok" ? (
            <>
              <p>
                <span className="text-muted-foreground">Database latency:</span> {result.latencyMs}
                ms
              </p>
              <p>
                <span className="text-muted-foreground">Checked at:</span> {result.checkedAt}
              </p>
            </>
          ) : (
            <p className="text-destructive">{result.message}</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
