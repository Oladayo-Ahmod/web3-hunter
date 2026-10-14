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

const ROUTE_LABEL: Record<SecurityTargetPriorityDTO["researchRoute"]["route"], string> = {
  "verified-bounty": "Verified bounty route",
  "disclosure-available": "Disclosure route available",
  "repository-research": "Independent research route",
  "needs-discovery": "Needs further discovery",
};

const ROUTE_BADGE_VARIANT: Record<
  SecurityTargetPriorityDTO["researchRoute"]["route"],
  "success" | "secondary" | "outline"
> = {
  "verified-bounty": "success",
  "disclosure-available": "success",
  "repository-research": "secondary",
  "needs-discovery": "outline",
};

function DisclosureRouteSection({
  label,
  route,
}: {
  label: string;
  route: SecurityTargetPriorityDTO["disclosure"]["securityTxt"];
}) {
  if (!route) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        <p className="text-sm text-muted-foreground">Not checked yet for this target.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      {route.found ? (
        <div className="space-y-1 text-sm">
          {route.contacts.map((contact) => (
            <p key={contact}>
              Contact:{" "}
              <a
                href={contact.startsWith("http") ? contact : undefined}
                className={contact.startsWith("http") ? "text-primary hover:underline" : undefined}
              >
                {contact}
              </a>
            </p>
          ))}
          {route.policyUrl && (
            <a
              href={route.policyUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-primary hover:underline"
            >
              Disclosure policy
            </a>
          )}
          <p className="text-xs text-muted-foreground">
            Source:{" "}
            <a href={route.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
              {route.sourceUrl}
            </a>
            {" · "}last checked {new Date(route.lastChangedAt).toLocaleDateString()}
            {route.isExpired && " · marked expired by its own publisher"}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Checked {new Date(route.lastChangedAt).toLocaleDateString()} — not published at{" "}
          <span className="font-mono text-xs">{route.sourceUrl}</span>.
        </p>
      )}
    </div>
  );
}

const usdCompactFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

function formatChangePercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function ProtocolMetricsLine({
  metrics,
}: {
  metrics: SecurityTargetPriorityDTO["protocolMetrics"];
}) {
  if (metrics.tvlUsd === null) {
    return (
      <p className="text-sm text-muted-foreground">
        No DefiLlama TVL figure on record for this target.
      </p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground">
      TVL (DefiLlama):{" "}
      <span className="font-medium text-foreground">
        {usdCompactFormatter.format(metrics.tvlUsd)}
      </span>
      {metrics.change1dPercent !== null && (
        <span className={metrics.change1dPercent >= 0 ? "text-success" : "text-destructive"}>
          {" "}
          {formatChangePercent(metrics.change1dPercent)} (1d)
        </span>
      )}
      {metrics.change7dPercent !== null && (
        <span className={metrics.change7dPercent >= 0 ? "text-success" : "text-destructive"}>
          {" "}
          {formatChangePercent(metrics.change7dPercent)} (7d)
        </span>
      )}
      {metrics.asOf && ` · as of ${new Date(metrics.asOf).toLocaleDateString()}`}
    </p>
  );
}

function IdentityLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {label}
    </a>
  );
}

export function SecurityTargetDetailView({ target }: { target: SecurityTargetPriorityDTO }) {
  const hasAnyIdentityLink =
    target.identity.repositoryUrl || target.identity.websiteUrl || target.identity.twitterUrl;

  return (
    <div className="space-y-6">
      {/* 1. Identity + readiness */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{target.name}</h1>
          <Badge variant={READINESS_BADGE_VARIANT[target.researchReadiness.status]}>
            {READINESS_LABEL[target.researchReadiness.status]}
          </Badge>
          <Badge variant={ROUTE_BADGE_VARIANT[target.researchRoute.route]}>
            {ROUTE_LABEL[target.researchRoute.route]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Signal tier {target.tier} — {target.tierReason}
        </p>
        <p className="text-sm text-muted-foreground">{target.researchReadiness.reason}</p>
        <ProtocolMetricsLine metrics={target.protocolMetrics} />

        {hasAnyIdentityLink ? (
          <div className="flex flex-wrap gap-2">
            {target.identity.repositoryUrl && (
              <IdentityLink href={target.identity.repositoryUrl} label="Repository" />
            )}
            {target.identity.websiteUrl && (
              <IdentityLink href={target.identity.websiteUrl} label="Official website" />
            )}
            {target.identity.twitterUrl && (
              <IdentityLink href={target.identity.twitterUrl} label="Twitter / X" />
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No repository, official website, or Twitter/X account on record for this target.
          </p>
        )}
      </div>

      {/* 2. Research route — the concrete next step, always present */}
      <Card className="border-primary/40 bg-primary/5">
        <CardHeader>
          <CardTitle className="text-base">What to do next</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-medium text-primary">{target.researchRoute.nextAction}</p>
        </CardContent>
      </Card>

      {/* 3. Disclosure & security contact — a published route is distinct
          from, and ranked above, a bare repository: it is evidence
          maintainers expect reports, not a guess. */}
      <Card>
        <CardHeader>
          <CardTitle>Disclosure & security contact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <DisclosureRouteSection label="security.txt" route={target.disclosure.securityTxt} />
          <div className="border-t pt-3">
            <DisclosureRouteSection
              label="GitHub security policy"
              route={target.disclosure.githubSecurityPolicy}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A published contact or policy is a legitimate reporting channel, not confirmation that
            any specific finding is in scope or that testing is authorized — follow whatever scope
            the route itself states.
          </p>
        </CardContent>
      </Card>

      {/* 4. Scope + actionability, neutral framing */}
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

      {/* 5. Audit evidence, honest 3-state framing — Immunefi's structured
          records and DefiLlama's bare links are kept visibly distinct, since
          the latter carry no auditor name or date and are never merged into
          the former. */}
      <Card>
        <CardHeader>
          <CardTitle>Audit history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Immunefi audit records
            </p>
            {target.audit.status === "unavailable" && (
              <p className="text-sm text-muted-foreground">
                No Immunefi bounty-program data has been recorded for this target, so there is
                nothing to say about audits one way or the other.
              </p>
            )}
            {target.audit.status === "none" && (
              <p className="text-sm text-muted-foreground">
                Immunefi bounty-program data is on record for this target, and it recorded no
                audits. This does not by itself mean the target has never been audited — see the
                note below.
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
          </div>

          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              DefiLlama audit links
            </p>
            {target.audit.defiLlamaAuditLinks.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {target.audit.defiLlamaAuditLinks.map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No audit links are listed in DefiLlama&apos;s own record for this target.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">{target.audit.limitation}</p>
        </CardContent>
      </Card>

      {/* 6. Stored detection reasoning, never framed as an independent audit finding */}
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

      {/* 7. Qualifying evidence, leads not confirmed vulnerabilities */}
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
