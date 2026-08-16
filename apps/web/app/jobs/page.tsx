import { jobFeedQuerySchema, listJobFeed } from "@web3-hunter/application";
import { PaginationControls } from "@/features/opportunities/components/pagination-controls";
import { JobCard } from "@/features/jobs/components/job-card";
import { JobFilters } from "@/features/jobs/components/job-filters";
import { getCurrentUserId } from "@/lib/session";

// Job data reflects live Event data; it must never be served from a
// build-time snapshot.
export const dynamic = "force-dynamic";

interface JobsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const rawParams = await searchParams;

  // A Server Component calls the Application Layer directly — never
  // through the public API — per the Milestone 4 access-pattern
  // refinement (docs/ARCHITECTURE.md §9).
  const viewerId = await getCurrentUserId();

  // Milestone 13 Phase 2: "best match + freshness, not just newest" is
  // the default *only* once there's a viewer to match against — an
  // explicit `?sort=` always wins. A viewer with no Profile yet still
  // works: `listJobFeed` falls back to its normal freshness-ordered path
  // whenever it has no Profile to score against, so this never produces
  // an empty or broken feed.
  const effectiveRawParams = {
    ...rawParams,
    sort: rawParams.sort ?? (viewerId ? "relevance" : undefined),
  };

  const parsed = jobFeedQuerySchema.safeParse(effectiveRawParams);
  const query = parsed.success ? parsed.data : jobFeedQuerySchema.parse({});

  const result = await listJobFeed(query, viewerId);

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.sort !== "postedAt") params.set("sort", query.sort);
    if (query.direction !== "desc") params.set("direction", query.direction);
    if (query.search) params.set("search", query.search);
    if (query.companyId) params.set("companyId", query.companyId);
    if (query.freshness) params.set("freshness", query.freshness);
    if (query.includeStale) params.set("includeStale", "true");
    if (query.workplaceType) params.set("workplaceType", query.workplaceType);
    if (query.role) params.set("role", query.role);
    if (query.minMatch !== undefined) params.set("minMatch", String(query.minMatch));
    if (!query.eligibleOnly) params.set("eligibleOnly", "false");
    params.set("page", String(page));
    params.set("pageSize", String(query.pageSize));
    return `/jobs?${params.toString()}`;
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Open Jobs</h1>
        <p className="text-muted-foreground">
          {result.totalCount} role{result.totalCount === 1 ? "" : "s"}
          {query.eligibleOnly
            ? " genuinely relevant to Web3/blockchain engineering — corporate, sales, and other unrelated roles are filtered out by default."
            : " shown, including generic/corporate roles the relevance filter would normally hide."}
          {query.sort === "relevance" && " Ranked by fit against your Profile."}
        </p>
      </div>

      <JobFilters
        defaultValues={{
          search: query.search,
          sort: query.sort,
          direction: query.direction,
          freshness: query.freshness,
          includeStale: query.includeStale,
          workplaceType: query.workplaceType,
          role: query.role,
          minMatch: query.minMatch,
          eligibleOnly: query.eligibleOnly,
        }}
        showRelevanceControls={viewerId !== undefined}
      />

      {result.items.length === 0 ? (
        <p className="text-muted-foreground">No open jobs match these filters yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}

      <PaginationControls page={result.page} totalPages={result.totalPages} buildHref={buildHref} />
    </main>
  );
}
