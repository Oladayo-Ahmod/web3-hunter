import { getRecommendationDetail } from "@web3-hunter/application";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@web3-hunter/ui";
import { notFound, redirect } from "next/navigation";
import { AIContentSection } from "@/features/ai/components/ai-content-section";
import { OpportunityDetailView } from "@/features/opportunities/components/opportunity-detail-view";
import { RecommendationActions } from "@/features/recommendations/components/recommendation-actions";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

interface RecommendationDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function RecommendationDetailPage({ params }: RecommendationDetailPageProps) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect("/sign-in");
  }

  const { id } = await params;
  const recommendation = await getRecommendationDetail(id, userId);

  if (!recommendation) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>Recommendation</span>
            <Badge>{Math.round(recommendation.priority * 100)}% priority</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{recommendation.reason}</p>
          <RecommendationActions
            recommendationId={recommendation.id}
            status={recommendation.status}
          />
        </CardContent>
      </Card>

      <AIContentSection
        title="AI Explanation"
        endpoint={`/api/recommendations/${recommendation.id}/explain`}
        initialArtifact={recommendation.aiExplanation}
      />

      <AIContentSection
        title="AI Outreach Draft"
        endpoint={`/api/recommendations/${recommendation.id}/outreach-draft`}
        initialArtifact={recommendation.aiOutreachDraft}
      />

      <OpportunityDetailView opportunity={recommendation.opportunity} />
    </main>
  );
}
