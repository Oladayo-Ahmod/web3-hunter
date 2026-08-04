import type { RecommendationSummaryDTO } from "@web3-hunter/application";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@web3-hunter/ui";
import Link from "next/link";
import { RecommendationActions } from "./recommendation-actions";

export function RecommendationCard({
  recommendation,
}: {
  recommendation: RecommendationSummaryDTO;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <Link href={`/recommendations/${recommendation.id}`} className="hover:underline">
            {recommendation.opportunity.company.name}
          </Link>
          <Badge>{Math.round(recommendation.priority * 100)}% priority</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground capitalize">
          {recommendation.opportunity.opportunityType.replaceAll("-", " ")}
        </p>
        <p>{recommendation.reason}</p>
        <RecommendationActions
          recommendationId={recommendation.id}
          status={recommendation.status}
        />
      </CardContent>
    </Card>
  );
}
