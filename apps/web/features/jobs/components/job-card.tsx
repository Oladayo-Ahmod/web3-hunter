import type { JobFeedItemDTO } from "@web3-hunter/application";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@web3-hunter/ui";
import Link from "next/link";

function relativeFreshness(postedAt: string): string {
  const days = Math.floor((Date.now() - new Date(postedAt).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Posted today";
  if (days === 1) return "Posted yesterday";
  return `Posted ${days}d ago`;
}

/**
 * A single open job posting — links straight to the source ATS listing
 * (`absoluteUrl`), since applying is the point; there is no internal job
 * detail page (Milestone 12 explicitly defers that until it earns its
 * keep).
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
            <Badge variant="outline" className="shrink-0">
              {relativeFreshness(job.postedAt)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{job.company.name}</p>
          {job.locationName && <p>{job.locationName}</p>}
          {job.departmentNames.length > 0 && <p>{job.departmentNames.join(", ")}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}
