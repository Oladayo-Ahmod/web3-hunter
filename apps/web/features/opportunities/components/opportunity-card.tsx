import type { OpportunityFeedItemDTO } from "@web3-hunter/application";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@web3-hunter/ui";
import Link from "next/link";

const STATUS_LABEL: Record<OpportunityFeedItemDTO["status"], string> = {
  detected: "Detected",
  scored: "Scored",
};

export function OpportunityCard({ opportunity }: { opportunity: OpportunityFeedItemDTO }) {
  return (
    <Link href={`/opportunities/${opportunity.id}`} className="block focus-visible:outline-none">
      <Card className="h-full transition-colors hover:border-primary focus-visible:border-primary">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>{opportunity.company.name}</span>
            {opportunity.score !== null ? (
              <Badge>{Math.round(opportunity.score * 100)}%</Badge>
            ) : (
              <Badge variant="outline">{STATUS_LABEL[opportunity.status]}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p className="capitalize">{opportunity.opportunityType.replaceAll("-", " ")}</p>
          <p>Detected {new Date(opportunity.detectedAt).toLocaleDateString()}</p>
          {opportunity.match && (
            <p className="text-primary">
              {Math.round(opportunity.match.score * 100)}% match
              {opportunity.match.matchedSkills.length > 0 &&
                ` · ${opportunity.match.matchedSkills.map((skill) => skill.name).join(", ")}`}
            </p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
