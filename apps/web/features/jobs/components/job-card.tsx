import type {
  CompanyPriorityDTO,
  JobFeedItemDTO,
  JobFreshnessDTO,
  JobRelevanceTierDTO,
} from "@web3-hunter/application";
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

// Green/amber/gray/red for high/medium/low/very-low — a scannable signal
// on a page meant to be skimmed fast, not read card-by-card (Milestone 13
// Phase 2's "let me rapidly scan and attack opportunities"). "very-low"
// (Phase A) gets its own, more muted treatment than "low" so a role-
// incompatible job never visually reads as merely "a bit less relevant."
const RELEVANCE_TIER_CLASS: Record<JobRelevanceTierDTO, string> = {
  high: "bg-success text-success-foreground",
  medium: "bg-amber-500 text-white dark:bg-amber-600",
  low: "bg-muted text-muted-foreground",
  "very-low": "bg-muted text-muted-foreground/70",
};

const PRIORITY_LABEL: Record<CompanyPriorityDTO, string> = {
  high: "Startup priority",
  medium: "Growing team",
  low: "Established",
};

/**
 * A single open job posting. Links to the internal `/jobs/[id]` detail
 * page (Milestone 13 Phase 2), not straight to the source ATS listing —
 * the detail page is where the relevance explanation and the actual
 * Apply link live, so a click here is "learn more," not "apply."
 *
 * The freshness badge is deliberately not "Posted Xd ago": `updatedAt` is
 * the *source's own* last-modified timestamp, not our fetch time — a
 * long-open, unedited requisition can carry a timestamp years old and
 * still be a live, open posting. Showing that as "Posted 2007d ago" reads
 * as "this appeared 2007 days ago," which isn't what the data says. The
 * freshness bucket (`packages/application/src/job-freshness.ts`) is the
 * honest version of the same signal — see
 * `docs/MILESTONE_13_JOB_HUNTING_PIVOT.md` §8/Phase 1.
 *
 * Milestone 22: every Job reaching this card already cleared the shared
 * eligibility gate (`job-query-service.ts`'s default `eligibleOnly`), so
 * this card's job is to communicate *why it's worth a look*, not to warn
 * about noise that shouldn't be here in the first place — company
 * priority (the same startup-bias signal `/outreach`/`/today` use) sits
 * right under the company name for that reason.
 */
export function JobCard({ job }: { job: JobFeedItemDTO }) {
  return (
    <Link href={`/jobs/${job.id}`} className="group block focus-visible:outline-none">
      <Card className="h-full gap-4 py-5 transition-all hover:border-primary hover:shadow-md focus-visible:border-primary">
        <CardHeader className="gap-1.5 px-5">
          <CardTitle className="flex items-start justify-between gap-2 text-base leading-snug">
            <span>{job.title}</span>
            {job.relevance ? (
              <Badge className={`shrink-0 ${RELEVANCE_TIER_CLASS[job.relevance.tier]}`}>
                {job.relevance.score}% match
              </Badge>
            ) : (
              <Badge variant={FRESHNESS_VARIANT[job.freshness]} className="shrink-0">
                {FRESHNESS_LABEL[job.freshness]}
              </Badge>
            )}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="font-medium text-foreground">{job.company.name}</span>
            {job.company.priority && (
              <span className="text-xs text-muted-foreground">
                · {PRIORITY_LABEL[job.company.priority]}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 px-5 text-sm text-muted-foreground">
          <p>
            {[
              job.locationName,
              job.workplaceType && WORKPLACE_TYPE_LABEL[job.workplaceType],
              job.employmentType &&
                job.employmentType !== "full-time" &&
                EMPLOYMENT_TYPE_LABEL[job.employmentType],
            ]
              .filter(Boolean)
              .join(" · ") || "Location not specified"}
          </p>
          {job.relevance && <p className="text-xs">{FRESHNESS_LABEL[job.freshness]}</p>}
          {job.detectedSkills.length > 0 && (
            <p className="text-xs">{job.detectedSkills.map((skill) => skill.name).join(" · ")}</p>
          )}
          <p className="pt-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
            View role →
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
