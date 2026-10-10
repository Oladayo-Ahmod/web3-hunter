import {
  getPipelineHealth,
  listSecurityTargetPriorityPage,
  securityTargetFeedQuerySchema,
} from "@web3-hunter/application";
import { PaginationControls } from "@/features/opportunities/components/pagination-controls";
import { deriveSecurityCollectorFreshness } from "@/features/security/collector-freshness";
import { CollectorFreshnessBanner } from "@/features/security/components/collector-freshness-banner";
import { SecurityTargetCard } from "@/features/security/components/security-target-card";
import { SecurityTargetFilters } from "@/features/security/components/security-target-filters";

const SECURITY_COLLECTOR_SLUGS = ["defillama", "immunefi"] as const;

// The feed reflects live Signal/Opportunity data; it must never be served
// from a build-time snapshot.
export const dynamic = "force-dynamic";

interface SecurityPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SecurityPage({ searchParams }: SecurityPageProps) {
  const rawParams = await searchParams;
  const parsed = securityTargetFeedQuerySchema.safeParse(rawParams);
  const query = parsed.success ? parsed.data : securityTargetFeedQuerySchema.parse({});

  // A Server Component calls the Application Layer directly — never
  // through a public API route — per docs/ARCHITECTURE.md §9.
  const [result, pipelineHealth] = await Promise.all([
    listSecurityTargetPriorityPage(query),
    // Mirrors `/api/health`'s own precedent: a failed health lookup
    // degrades to `null` rather than breaking the feed — `null` reads
    // as "freshness unknown" for every collector below, never "fresh."
    getPipelineHealth().catch(() => null),
  ]);

  const collectorFreshness = SECURITY_COLLECTOR_SLUGS.map((slug) =>
    deriveSecurityCollectorFreshness(pipelineHealth, slug),
  );

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.tier) params.set("tier", query.tier);
    if (query.readiness) params.set("readiness", query.readiness);
    if (query.sort !== "slug") params.set("sort", query.sort);
    params.set("page", String(page));
    params.set("pageSize", String(query.pageSize));
    return `/security?${params.toString()}`;
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Security Research Feed</h1>
        <p className="text-muted-foreground">
          {result.totalCount} Security Target{result.totalCount === 1 ? "" : "s"} tracked from
          observed on-chain and bug-bounty activity.
        </p>
        <p className="text-sm text-muted-foreground">
          This feed surfaces leads worth investigating, not confirmed vulnerabilities. Signal tier
          reflects what changed; research readiness reflects whether there is a concrete next step
          today.
        </p>
      </div>

      <CollectorFreshnessBanner collectors={collectorFreshness} />

      <SecurityTargetFilters
        defaultValues={{ tier: query.tier, readiness: query.readiness, sort: query.sort }}
      />

      {result.items.length === 0 ? (
        <p className="text-muted-foreground">No Security Targets match these filters yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((target) => (
            <SecurityTargetCard key={target.id} target={target} />
          ))}
        </div>
      )}

      <PaginationControls page={result.page} totalPages={result.totalPages} buildHref={buildHref} />
    </main>
  );
}
