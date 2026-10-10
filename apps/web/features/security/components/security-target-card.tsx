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
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>Signal tier: {target.tier}</p>
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
