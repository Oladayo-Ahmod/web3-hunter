import type { CompanyProfileDTO } from "@web3-hunter/application";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@web3-hunter/ui";
import { AIContentSection } from "@/features/ai/components/ai-content-section";
import { OpportunityCard } from "../../opportunities/components/opportunity-card";

export function CompanyProfileView({ profile }: { profile: CompanyProfileDTO }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{profile.company.name}</h1>
        <p className="text-sm text-muted-foreground">{profile.company.slug}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hiring profile</CardTitle>
        </CardHeader>
        <CardContent>
          {profile.intelligence ? (
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <Stat label="Trend" value={profile.intelligence.trend.replaceAll("-", " ")} />
              <Stat
                label="Confidence"
                value={`${Math.round(profile.intelligence.confidence * 100)}%`}
              />
              <Stat label="Signals" value={String(profile.intelligence.signalCount)} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No hiring activity recorded yet.</p>
          )}
        </CardContent>
      </Card>

      {profile.technologyProfile && (
        <Card>
          <CardHeader>
            <CardTitle>Technology Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {profile.technologyProfile.technologies.map((technology) => (
                <Badge key={technology.id} variant="secondary">
                  {technology.name}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Deterministically evidenced by this Company&apos;s public GitHub activity —{" "}
              {profile.technologyProfile.evidenceCount} detection(s) as of{" "}
              {new Date(profile.technologyProfile.asOf).toLocaleDateString()}.
            </p>
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Active Opportunities</h2>
        {profile.activeOpportunities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Opportunities detected yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {profile.activeOpportunities.map((opportunity) => (
              <OpportunityCard key={opportunity.id} opportunity={opportunity} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Recent Signals</h2>
        {profile.recentSignals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Signals recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {profile.recentSignals.map((signal) => (
              <div key={signal.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize">
                    {signal.signalType.replaceAll("-", " ")}
                  </span>
                  <Badge variant="secondary">{Math.round(signal.weight * 100)}%</Badge>
                </div>
                <p className="mt-1 text-muted-foreground">{signal.reasoning}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <AIContentSection
        title="AI Summary"
        endpoint={`/api/companies/${profile.company.slug}/summarize`}
        initialArtifact={profile.aiSummary}
      />
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
