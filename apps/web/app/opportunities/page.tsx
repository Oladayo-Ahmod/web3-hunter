import { listOpportunityFeed, opportunityFeedQuerySchema } from "@web3-hunter/application";
import { OpportunityCard } from "@/features/opportunities/components/opportunity-card";
import { OpportunityFilters } from "@/features/opportunities/components/opportunity-filters";
import { PaginationControls } from "@/features/opportunities/components/pagination-controls";

// The feed reflects live Signal/Opportunity data; it must never be served
// from a build-time snapshot.
export const dynamic = "force-dynamic";

interface OpportunitiesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OpportunitiesPage({ searchParams }: OpportunitiesPageProps) {
  const rawParams = await searchParams;
  const parsed = opportunityFeedQuerySchema.safeParse(rawParams);
  const query = parsed.success ? parsed.data : opportunityFeedQuerySchema.parse({});

  const result = await listOpportunityFeed(query);

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.sort !== "score") params.set("sort", query.sort);
    if (query.direction !== "desc") params.set("direction", query.direction);
    if (query.opportunityType) params.set("opportunityType", query.opportunityType);
    if (query.status) params.set("status", query.status);
    if (query.minScore !== undefined) params.set("minScore", String(query.minScore));
    params.set("page", String(page));
    params.set("pageSize", String(query.pageSize));
    return `/opportunities?${params.toString()}`;
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Opportunity Feed</h1>
        <p className="text-muted-foreground">
          Explainable, deterministic hiring-intent Opportunities — {result.totalCount} total.
        </p>
      </div>

      <OpportunityFilters
        defaultValues={{
          status: query.status,
          opportunityType: query.opportunityType,
          minScore: query.minScore,
          sort: query.sort,
          direction: query.direction,
        }}
      />

      {result.items.length === 0 ? (
        <p className="text-muted-foreground">No Opportunities match these filters yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((opportunity) => (
            <OpportunityCard key={opportunity.id} opportunity={opportunity} />
          ))}
        </div>
      )}

      <PaginationControls page={result.page} totalPages={result.totalPages} buildHref={buildHref} />
    </main>
  );
}
