import type { OpportunityDetailDTO } from "@web3-hunter/application";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@web3-hunter/ui";
import Link from "next/link";

export function OpportunityDetailView({ opportunity }: { opportunity: OpportunityDetailDTO }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/companies/${opportunity.company.slug}`}
          className="text-sm text-primary hover:underline"
        >
          {opportunity.company.name}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight capitalize">
            {opportunity.opportunityType.replaceAll("-", " ")}
          </h1>
          {opportunity.score !== null && (
            <Badge>{Math.round(opportunity.score * 100)}% score</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Detection window {opportunity.detectionWindow} · Detected{" "}
          {new Date(opportunity.detectedAt).toLocaleDateString()}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Why this Opportunity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{opportunity.reasoning}</p>
        </CardContent>
      </Card>

      {opportunity.match && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span>Your Match</span>
              <Badge>{Math.round(opportunity.match.score * 100)}%</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{opportunity.match.reasoning}</p>
            {opportunity.match.matchedSkills.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {opportunity.match.matchedSkills.map((skill) => (
                  <Badge key={skill.id} variant="secondary">
                    {skill.name}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {opportunity.companyIntelligence && (
        <Card>
          <CardHeader>
            <CardTitle>Company Intelligence</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Stat
              label="Trend"
              value={opportunity.companyIntelligence.trend.replaceAll("-", " ")}
            />
            <Stat
              label="Confidence"
              value={`${Math.round(opportunity.companyIntelligence.confidence * 100)}%`}
            />
            <Stat label="Signals" value={String(opportunity.companyIntelligence.signalCount)} />
            <Stat
              label="Freshness"
              value={
                opportunity.freshness.asOf
                  ? new Date(opportunity.freshness.asOf).toLocaleDateString()
                  : "—"
              }
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Supporting Signals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {opportunity.signals.length === 0 && (
            <p className="text-sm text-muted-foreground">No Signals recorded yet.</p>
          )}
          {opportunity.signals.map((signal) => (
            <div key={signal.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium capitalize">
                  {signal.signalType.replaceAll("-", " ")}
                </span>
                <Badge variant="secondary">{Math.round(signal.weight * 100)}%</Badge>
              </div>
              <p className="mt-1 text-muted-foreground">{signal.reasoning}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(signal.detectedAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground capitalize">{label}</p>
      <p className="font-medium capitalize">{value}</p>
    </div>
  );
}
