import type { SecurityTargetPriorityDTO } from "@web3-hunter/application";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@web3-hunter/ui";

const READINESS_LABEL: Record<SecurityTargetPriorityDTO["researchReadiness"]["status"], string> = {
  ready: "Ready to research",
  "insufficient-evidence": "Insufficient evidence",
  "no-current-route": "No current route",
};

const READINESS_BADGE_VARIANT: Record<
  SecurityTargetPriorityDTO["researchReadiness"]["status"],
  "success" | "secondary" | "outline"
> = {
  ready: "success",
  "insufficient-evidence": "secondary",
  "no-current-route": "outline",
};

export function SecurityTargetDetailView({ target }: { target: SecurityTargetPriorityDTO }) {
  return (
    <div className="space-y-6">
      {/* 1. Identity + readiness */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{target.name}</h1>
          <Badge variant={READINESS_BADGE_VARIANT[target.researchReadiness.status]}>
            {READINESS_LABEL[target.researchReadiness.status]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Signal tier {target.tier} — {target.tierReason}
        </p>
        <p className="text-sm text-muted-foreground">{target.researchReadiness.reason}</p>
        {target.researchReadiness.nextAction && (
          <p className="text-sm font-medium text-primary">{target.researchReadiness.nextAction}</p>
        )}
        {target.identity.repositoryUrl ? (
          <a
            href={target.identity.repositoryUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-sm text-primary hover:underline"
          >
            Repository
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">No repository on record for this target.</p>
        )}
      </div>

      {/* 2. Scope + actionability, neutral framing */}
      <Card>
        <CardHeader>
          <CardTitle>In-scope assets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{target.actionability.reason}</p>
          {target.actionability.scopeUrl && (
            <a
              href={target.actionability.scopeUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm text-primary hover:underline"
            >
              Bug bounty program page
            </a>
          )}
          {target.actionability.assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No in-scope assets on record.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {target.actionability.assets.map((asset) => (
                <li key={asset.id} className="rounded-md border p-3">
                  <p>{asset.description ?? "Unnamed asset"}</p>
                  {asset.url && (
                    <a
                      href={asset.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      {asset.url}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 3. Audit evidence, honest 3-state framing */}
      <Card>
        <CardHeader>
          <CardTitle>Audit history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {target.audit.status === "unavailable" && (
            <p className="text-sm text-muted-foreground">
              No audit data is available for this target.
            </p>
          )}
          {target.audit.status === "none" && (
            <p className="text-sm text-muted-foreground">
              Audit data is available for this target, and it recorded no audits.
            </p>
          )}
          {target.audit.status === "present" && (
            <ul className="space-y-2 text-sm">
              {target.audit.entries.map((entry) => (
                <li key={entry.id} className="rounded-md border p-3">
                  <p>{entry.auditor ?? "Unknown auditor"}</p>
                  <p className="text-xs text-muted-foreground">{entry.date ?? "Date unknown"}</p>
                  {entry.url && (
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      {entry.url}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">{target.audit.limitation}</p>
        </CardContent>
      </Card>

      {/* 4. Stored detection reasoning, never framed as an independent audit finding */}
      {target.hasOpportunity && target.opportunityReasoning && (
        <Card>
          <CardHeader>
            <CardTitle>Stored detection reasoning</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{target.opportunityReasoning}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              This is the system&apos;s own recorded reasoning for why this target was flagged — it
              is not an independent audit finding or a confirmed vulnerability.
            </p>
          </CardContent>
        </Card>
      )}

      {/* 5. Qualifying evidence, leads not confirmed vulnerabilities */}
      <Card>
        <CardHeader>
          <CardTitle>Qualifying signals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            These are leads worth investigating, not confirmed vulnerabilities.
          </p>
          {target.qualifyingSignalTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No qualifying signals recorded yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {target.qualifyingSignalTypes.map((type) => (
                <Badge key={type} variant="secondary">
                  {type.replaceAll("-", " ")}
                </Badge>
              ))}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {target.distinctEvidenceEventCount} distinct evidence event
            {target.distinctEvidenceEventCount === 1 ? "" : "s"}
            {target.lastSignalAt &&
              ` · last signal ${new Date(target.lastSignalAt).toLocaleDateString()}`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
