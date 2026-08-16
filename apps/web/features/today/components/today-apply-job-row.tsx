import type {
  CompanyPriorityDTO,
  JobFreshnessDTO,
  TodayApplyJobDTO,
} from "@web3-hunter/application";
import { Badge, Card, CardContent } from "@web3-hunter/ui";

const FRESHNESS_LABEL: Record<JobFreshnessDTO, string> = {
  fresh: "This week",
  recent: "This month",
  aging: "1-2mo ago",
  stale: "60d+",
};

const PRIORITY_LABEL: Record<CompanyPriorityDTO, string> = {
  high: "Startup priority",
  medium: "Growing team",
  low: "Established",
};

const WORKPLACE_LABEL: Record<NonNullable<TodayApplyJobDTO["workplaceType"]>, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
};

/**
 * One "Apply" row in the Today Digest — deliberately not `JobCard`: this
 * links straight to the source ATS listing (`absoluteUrl`), since the
 * whole point of this section is "click, apply, move to the next one,"
 * not "learn more" (see `JobCard`'s own doc comment for why *that* card
 * links inward instead).
 */
export function TodayApplyJobRow({ job }: { job: TodayApplyJobDTO }) {
  return (
    <a href={job.absoluteUrl} target="_blank" rel="noreferrer" className="group block">
      <Card className="gap-0 py-0 transition-all hover:border-primary hover:shadow-md">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">{job.title}</p>
            <p className="text-sm text-muted-foreground">
              {job.companyName}
              {job.locationName ? ` · ${job.locationName}` : ""}
              {job.workplaceType ? ` · ${WORKPLACE_LABEL[job.workplaceType]}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {job.companyPriority && (
              <Badge variant="outline">{PRIORITY_LABEL[job.companyPriority]}</Badge>
            )}
            {job.relevanceScore !== null && (
              <Badge className="bg-success text-success-foreground">
                {job.relevanceScore}% match
              </Badge>
            )}
            <Badge variant="outline">{FRESHNESS_LABEL[job.freshness]}</Badge>
            <span className="text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
              Apply →
            </span>
          </div>
        </CardContent>
      </Card>
    </a>
  );
}
