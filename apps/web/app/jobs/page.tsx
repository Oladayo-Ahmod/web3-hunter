import { jobFeedQuerySchema, listJobFeed } from "@web3-hunter/application";
import { PaginationControls } from "@/features/opportunities/components/pagination-controls";
import { JobCard } from "@/features/jobs/components/job-card";
import { JobFilters } from "@/features/jobs/components/job-filters";

// Job data reflects live Event data; it must never be served from a
// build-time snapshot.
export const dynamic = "force-dynamic";

interface JobsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function JobsPage({ searchParams }: JobsPageProps) {
  const rawParams = await searchParams;
  const parsed = jobFeedQuerySchema.safeParse(rawParams);
  const query = parsed.success ? parsed.data : jobFeedQuerySchema.parse({});

  // A Server Component calls the Application Layer directly — never
  // through the public API — per the Milestone 4 access-pattern
  // refinement (docs/ARCHITECTURE.md §9).
  const result = await listJobFeed(query);

  const buildHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.sort !== "postedAt") params.set("sort", query.sort);
    if (query.direction !== "desc") params.set("direction", query.direction);
    if (query.search) params.set("search", query.search);
    if (query.companyId) params.set("companyId", query.companyId);
    if (query.freshness) params.set("freshness", query.freshness);
    if (query.includeStale) params.set("includeStale", "true");
    params.set("page", String(page));
    params.set("pageSize", String(query.pageSize));
    return `/jobs?${params.toString()}`;
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Open Jobs</h1>
        <p className="text-muted-foreground">
          Active postings across every tracked company — {result.totalCount} open right now.
        </p>
      </div>

      <JobFilters
        defaultValues={{
          search: query.search,
          sort: query.sort,
          direction: query.direction,
          freshness: query.freshness,
          includeStale: query.includeStale,
        }}
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
