import { listRecommendations } from "@web3-hunter/application";
import { redirect } from "next/navigation";
import Link from "next/link";
import { RecommendationCard } from "@/features/recommendations/components/recommendation-card";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = ["active", "dismissed", "archived", "expired"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function isStatusFilter(value: string | undefined): value is StatusFilter {
  return STATUS_FILTERS.includes(value as StatusFilter);
}

interface RecommendationsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function RecommendationsPage({ searchParams }: RecommendationsPageProps) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect("/sign-in");
  }

  const rawStatus = (await searchParams).status;
  const status = isStatusFilter(typeof rawStatus === "string" ? rawStatus : undefined)
    ? (rawStatus as StatusFilter)
    : "active";

  const recommendations = await listRecommendations(userId, status);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your Recommendations</h1>
        <p className="text-muted-foreground">
          Deterministically prioritized from your Matches — the Decision Engine, not AI.
        </p>
      </div>

      <nav className="flex gap-3 text-sm">
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter}
            href={`/recommendations?status=${filter}`}
            className={
              filter === status
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }
          >
            {filter[0]?.toUpperCase()}
            {filter.slice(1)}
          </Link>
        ))}
      </nav>

      {recommendations.length === 0 ? (
        <p className="text-muted-foreground">No {status} Recommendations yet.</p>
      ) : (
        <div className="space-y-4">
          {recommendations.map((recommendation) => (
            <RecommendationCard key={recommendation.id} recommendation={recommendation} />
          ))}
        </div>
      )}
    </main>
  );
}
