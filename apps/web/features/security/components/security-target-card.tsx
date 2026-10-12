import type { SecurityTargetPriorityDTO } from "@web3-hunter/application";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@web3-hunter/ui";
import Link from "next/link";

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
  "verified-bounty": "Verified bounty",
  "disclosure-available": "Disclosure available",
  "repository-research": "Independent research",
  "needs-discovery": "Needs discovery",
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

export function SecurityTargetCard({ target }: { target: SecurityTargetPriorityDTO }) {
  return (
    <Link href={`/security/${target.slug}`} className="block focus-visible:outline-none">
      <Card className="h-full transition-colors hover:border-primary focus-visible:border-primary">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>{target.name}</span>
            <Badge variant={READINESS_BADGE_VARIANT[target.researchReadiness.status]}>
              {READINESS_LABEL[target.researchReadiness.status]}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center justify-between gap-2">
            <span>Signal tier: {target.tier}</span>
            <Badge variant={ROUTE_BADGE_VARIANT[target.researchRoute.route]}>
              {ROUTE_LABEL[target.researchRoute.route]}
            </Badge>
          </div>
          <p>
            {target.qualifyingSignalTypes.length > 0
              ? target.qualifyingSignalTypes.join(", ").replaceAll("-", " ")
              : "No qualifying signals yet"}
          </p>
          <p>
            {target.distinctEvidenceEventCount} evidence event
            {target.distinctEvidenceEventCount === 1 ? "" : "s"}
          </p>
          <p>
            {target.lastSignalAt
              ? `Last signal ${new Date(target.lastSignalAt).toLocaleDateString()}`
              : "No signal recorded yet"}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
