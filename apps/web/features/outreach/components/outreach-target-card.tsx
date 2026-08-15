import type {
  CompanyContactRoleDTO,
  CompanyPriorityDTO,
  OutreachTargetDTO,
} from "@web3-hunter/application";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@web3-hunter/ui";
import Link from "next/link";

const PRIORITY_LABEL: Record<CompanyPriorityDTO, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};

// Same green/amber/gray scale `JobCard` uses for its relevance tiers — a
// deliberately reused, already-scannable convention, not a new palette.
const PRIORITY_CLASS: Record<CompanyPriorityDTO, string> = {
  high: "bg-emerald-600 text-white dark:bg-emerald-500",
  medium: "bg-amber-500 text-white dark:bg-amber-600",
  low: "bg-muted text-muted-foreground",
};

const CONTACT_ROLE_LABEL: Record<CompanyContactRoleDTO, string> = {
  founder: "Founder",
  cofounder: "Co-founder",
  cto: "CTO",
  head_of_engineering: "Head of Engineering",
  security_lead: "Security Lead",
  protocol_lead: "Protocol Lead",
  other: "Team",
};

/**
 * One Outreach Target — Milestone 17/18's actionable card. Every link
 * here is either the Company's own site/social presence or a Contact's
 * own public profile: nothing on this card is fabricated (`data-quality`
 * rules, docs/MILESTONE_16...). Deliberately not a `<Link>`-wrapped whole
 * card like `JobCard` — this card *is* a set of destinations (site,
 * careers page, each contact's profile), not a single detail page to
 * drill into.
 */
export function OutreachTargetCard({ target }: { target: OutreachTargetDTO }) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2 text-base">
          <span>{target.name}</span>
          {target.priority && (
            <Badge className={`shrink-0 ${PRIORITY_CLASS[target.priority]}`}>
              {PRIORITY_LABEL[target.priority]}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 text-sm text-muted-foreground">
        <p className="text-foreground italic">{target.reasonToContact}</p>

        {target.description && <p>{target.description}</p>}

        {target.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {target.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {target.openJobCount > 0 && (
          <div>
            <p className="font-medium text-foreground">
              {target.openJobCount} open role{target.openJobCount === 1 ? "" : "s"}
            </p>
            {target.openJobTitles.length > 0 && (
              <p className="text-xs">{target.openJobTitles.join(" · ")}</p>
            )}
          </div>
        )}

        {target.recentlyFunded && (
          <p>
            💰 Recently funded
            {target.fundingAmount ? ` — ${target.fundingAmount}` : ""}
            {target.fundingStage ? ` (${target.fundingStage})` : ""}
            {target.fundingDate ? `, ${target.fundingDate}` : ""}
          </p>
        )}
        {!target.recentlyFunded && target.fundingStage && <p>Funding: {target.fundingStage}</p>}

        {target.contacts.length > 0 ? (
          <div className="space-y-1 border-t pt-2">
            {target.contacts.map((contact) => (
              <div key={contact.profileUrl} className="flex items-center justify-between gap-2">
                <span className="text-foreground">
                  {contact.name}{" "}
                  <span className="text-muted-foreground">
                    · {CONTACT_ROLE_LABEL[contact.role]}
                  </span>
                </span>
                <a
                  href={contact.profileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-primary hover:underline"
                >
                  Profile
                </a>
              </div>
            ))}
          </div>
        ) : (
          <p className="border-t pt-2 text-xs text-muted-foreground">
            No verified contact yet — reach out via the company&apos;s site or careers page.
          </p>
        )}

        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          {target.openJobCount > 0 && (
            <Link
              href={`/jobs?companyId=${target.id}`}
              className="text-xs font-medium text-primary hover:underline"
            >
              View open roles →
            </Link>
          )}
          {target.careersPageUrl && (
            <a
              href={target.careersPageUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Careers
            </a>
          )}
          {target.websiteUrl && (
            <a
              href={target.websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Website
            </a>
          )}
          {target.twitterUrl && (
            <a
              href={target.twitterUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              X
            </a>
          )}
          {target.linkedinUrl && (
            <a
              href={target.linkedinUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              LinkedIn
            </a>
          )}
          <Link
            href={`/companies/${target.slug}`}
            className="text-xs text-muted-foreground hover:underline"
          >
            Full profile
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
