import { Badge } from "@web3-hunter/ui";
import type { SecurityCollectorFreshness } from "@/features/security/collector-freshness";

const STATE_LABEL: Record<SecurityCollectorFreshness["state"], string> = {
  fresh: "Current",
  stale: "Stale",
  "never-collected": "No collection on record",
  failing: "Collection failing",
  unknown: "Freshness unknown",
};

const STATE_BADGE_VARIANT: Record<
  SecurityCollectorFreshness["state"],
  "success" | "secondary" | "destructive" | "outline"
> = {
  fresh: "success",
  stale: "secondary",
  "never-collected": "outline",
  failing: "destructive",
  unknown: "outline",
};

const COLLECTOR_LABEL: Record<string, string> = {
  defillama: "DefiLlama",
  immunefi: "Immunefi",
};

/**
 * Shows DefiLlama's and Immunefi's collection freshness independently —
 * deliberately never collapsed into one combined "healthy" indicator, so
 * one failing/stale source can't be hidden by the other being fine.
 */
export function CollectorFreshnessBanner({
  collectors,
}: {
  collectors: SecurityCollectorFreshness[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border p-4 text-sm">
      <span className="font-medium text-muted-foreground">Underlying data sources:</span>
      {collectors.map((collector) => (
        <div key={collector.slug} className="flex items-center gap-2">
          <span>{COLLECTOR_LABEL[collector.slug] ?? collector.slug}</span>
          <Badge variant={STATE_BADGE_VARIANT[collector.state]}>
            {STATE_LABEL[collector.state]}
          </Badge>
          {collector.state === "fresh" && collector.lastRunAt && (
            <span className="text-muted-foreground">
              as of {new Date(collector.lastRunAt).toLocaleString()}
            </span>
          )}
          {collector.state === "stale" && collector.lastRunAt && (
            <span className="text-muted-foreground">
              last collected {new Date(collector.lastRunAt).toLocaleString()}
            </span>
          )}
          {collector.state === "failing" && collector.consecutiveFailures !== null && (
            <span className="text-muted-foreground">
              {collector.consecutiveFailures} consecutive failure
              {collector.consecutiveFailures === 1 ? "" : "s"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
