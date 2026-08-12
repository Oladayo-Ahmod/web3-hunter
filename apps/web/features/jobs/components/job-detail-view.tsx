import type { JobFeedItemDTO } from "@web3-hunter/application";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@web3-hunter/ui";
import Link from "next/link";

const TIER_LABEL = { high: "High match", medium: "Medium match", low: "Low match" } as const;

/**
 * The Job Detail page (Milestone 13 Phase 2) — what a card in `/jobs`
 * expands into. The primary CTA (Apply, linking straight to the source
 * ATS's own application page) sits at the top, unconditionally — never
 * behind or below the relevance/company-intelligence context, per that
 * milestone's explicit "do not bury the actual application action"
 * requirement.
 */
export function JobDetailView({ job }: { job: JobFeedItemDTO }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/companies/${job.company.slug}`}
          className="text-sm text-primary hover:underline"
        >
          {job.company.name}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
          {job.relevance && (
            <Badge>
              {job.relevance.score}% — {TIER_LABEL[job.relevance.tier]}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {[job.locationName, job.departmentNames.join(", ")].filter(Boolean).join(" · ")}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg">
          <a href={job.absoluteUrl} target="_blank" rel="noopener noreferrer">
            Apply Now
          </a>
        </Button>
        {job.company.careersPageUrl && (
          <Button asChild variant="outline">
            <a href={job.company.careersPageUrl} target="_blank" rel="noopener noreferrer">
              Company Careers Page
            </a>
          </Button>
        )}
        {job.company.websiteUrl && (
          <Button asChild variant="outline">
            <a href={job.company.websiteUrl} target="_blank" rel="noopener noreferrer">
              Company Website
            </a>
          </Button>
        )}
      </div>

      {job.relevance && (
        <Card>
          <CardHeader>
            <CardTitle>Why this matches you</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {job.relevance.breakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No overlap detected yet between this posting and your Profile.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {job.relevance.breakdown.map((entry, index) => (
                  <li key={index} className="flex items-center justify-between gap-4">
                    <span>
                      {entry.weight >= 0 ? "✓ " : "⚠ "}
                      {entry.label}
                    </span>
                    <span className={entry.weight >= 0 ? "text-emerald-600" : "text-amber-600"}>
                      {entry.weight >= 0 ? "+" : ""}
                      {entry.weight}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>About this role</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-1">
            {job.workplaceType && <Badge variant="outline">{job.workplaceType}</Badge>}
            {job.employmentType && <Badge variant="outline">{job.employmentType}</Badge>}
            <Badge variant="outline">{job.freshness}</Badge>
          </div>
          {job.detectedSkills.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {job.detectedSkills.map((skill) => (
                <Badge key={skill.id} variant="secondary">
                  {skill.name}
                </Badge>
              ))}
            </div>
          )}
          {job.description ? (
            <p className="whitespace-pre-line text-muted-foreground">{job.description}</p>
          ) : (
            <p className="text-muted-foreground">
              No description captured from the source for this posting.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
