import type { JobFeedItemDTO, JobFreshnessDTO } from "@web3-hunter/application";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@web3-hunter/ui";
import Link from "next/link";

const FRESHNESS_LABEL: Record<JobFreshnessDTO, string> = {
  fresh: "Updated this week",
  recent: "Updated this month",
  aging: "Updated 1-2mo ago",
  stale: "Not updated in 60d+",
};

// Only "fresh" gets the default (solid) Badge — everything else is
// `outline`, so a stale posting never visually reads as equally current.
const FRESHNESS_VARIANT: Record<JobFreshnessDTO, "default" | "outline"> = {
  fresh: "default",
  recent: "outline",
  aging: "outline",
  stale: "outline",
};

const EMPLOYMENT_TYPE_LABEL: Record<NonNullable<JobFeedItemDTO["employmentType"]>, string> = {
  "full-time": "Full-time",
  "part-time": "Part-time",
  contract: "Contract",
  internship: "Internship",
};

const WORKPLACE_TYPE_LABEL: Record<NonNullable<JobFeedItemDTO["workplaceType"]>, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
};

/**
 * A single open job posting — links straight to the source ATS listing
 * (`absoluteUrl`), since applying is the point; there is no internal job
 * detail page (Milestone 12 explicitly defers that until it earns its
 * keep).
 *
 * The freshness badge is deliberately not "Posted Xd ago": `updatedAt` is
 * the *source's own* last-modified timestamp, not our fetch time — a
 * long-open, unedited requisition can carry a timestamp years old and
 * still be a live, open posting. Showing that as "Posted 2007d ago" reads
 * as "this appeared 2007 days ago," which isn't what the data says. The
 * freshness bucket (`packages/application/src/job-freshness.ts`) is the
 * honest version of the same signal — see
 * `docs/MILESTONE_13_JOB_HUNTING_PIVOT.md` §8/Phase 1.
 */
export function JobCard({ job }: { job: JobFeedItemDTO }) {
  return (
    <Link
      href={job.absoluteUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block focus-visible:outline-none"
    >
      <Card className="h-full transition-colors hover:border-primary focus-visible:border-primary">
        <CardHeader>
          <CardTitle className="flex items-start justify-between gap-2 text-base">
            <span>{job.title}</span>
            <Badge variant={FRESHNESS_VARIANT[job.freshness]} className="shrink-0">
              {FRESHNESS_LABEL[job.freshness]}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{job.company.name}</p>
          {job.locationName && <p>{job.locationName}</p>}
          {job.departmentNames.length > 0 && <p>{job.departmentNames.join(", ")}</p>}
          {(job.workplaceType || job.employmentType) && (
            <div className="flex flex-wrap gap-1 pt-1">
              {job.workplaceType && (
                <Badge variant="outline">{WORKPLACE_TYPE_LABEL[job.workplaceType]}</Badge>
              )}
              {job.employmentType && (
                <Badge variant="outline">{EMPLOYMENT_TYPE_LABEL[job.employmentType]}</Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
