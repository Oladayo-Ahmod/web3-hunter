import type {
  CompanyContactRoleDTO,
  CompanyPriorityDTO,
  OutreachTargetDTO,
} from "@web3-hunter/application";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@web3-hunter/ui";
import Link from "next/link";

const PRIORITY_LABEL: Record<CompanyPriorityDTO, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};

// Same green/amber/gray scale `JobCard` uses for its relevance tiers — a
// deliberately reused, already-scannable convention, not a new palette.
const PRIORITY_CLASS: Record<CompanyPriorityDTO, string> = {
  high: "bg-success text-success-foreground",
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
 * One Outreach Target — Milestone 17/18's actionable card, given a real
 * visual-hierarchy pass in Milestone 22 (bigger callout for
 * `reasonToContact`, actual `Button`-styled CTAs instead of plain text
 * links, so "DM Founder"/"View Role"/"Website" read as obvious actions
 * rather than blending into the card's other text — the governing
 * directive's explicit UI ask). Every link here is still either the
 * Company's own site/social presence or a Contact's own public profile:
 * nothing on this card is fabricated (`data-quality` rules,
 * docs/MILESTONE_16...).
 */
export function OutreachTargetCard({ target }: { target: OutreachTargetDTO }) {
  const primaryContact = target.contacts[0];

  return (
    <Card className="flex h-full flex-col gap-4 py-5">
      <CardHeader className="gap-1.5 px-5">
        <CardTitle className="flex items-start justify-between gap-2 text-base leading-snug">
          <span>{target.name}</span>
          {target.priority && (
            <Badge className={`shrink-0 ${PRIORITY_CLASS[target.priority]}`}>
              {PRIORITY_LABEL[target.priority]}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 px-5 text-sm text-muted-foreground">
        <p className="rounded-md border border-primary/20 bg-accent/60 px-3 py-2 text-foreground">
          {target.reasonToContact}
        </p>

        {target.description && <p className="text-sm">{target.description}</p>}

        {target.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {target.tags.slice(0, 5).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[11px]">
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
          <div className="space-y-1.5 border-t pt-3">
            {target.contacts.map((contact) => (
              <div key={contact.profileUrl} className="flex items-center justify-between gap-2">
                <span className="text-foreground">
                  {contact.name}{" "}
                  <span className="text-muted-foreground">
                    · {CONTACT_ROLE_LABEL[contact.role]}
                  </span>
                </span>
                <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                  <a href={contact.profileUrl} target="_blank" rel="noreferrer">
                    Profile
                  </a>
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            No verified contact yet — reach out via the company&apos;s site or careers page.
          </p>
        )}

        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          {target.openJobCount > 0 ? (
            <Button asChild size="sm">
              <Link href={`/jobs?companyId=${target.id}`}>View open roles</Link>
            </Button>
          ) : (
            primaryContact && (
              <Button asChild size="sm">
                <a href={primaryContact.profileUrl} target="_blank" rel="noreferrer">
                  DM {CONTACT_ROLE_LABEL[primaryContact.role]}
                </a>
              </Button>
            )
          )}
          {target.websiteUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={target.websiteUrl} target="_blank" rel="noreferrer">
                Website
              </a>
            </Button>
          )}
          {target.careersPageUrl && (
            <Button asChild variant="outline" size="sm">
              <a href={target.careersPageUrl} target="_blank" rel="noreferrer">
                Careers
              </a>
            </Button>
          )}
          {target.twitterUrl && (
            <Button asChild variant="ghost" size="sm">
              <a href={target.twitterUrl} target="_blank" rel="noreferrer">
                X
              </a>
            </Button>
          )}
          {target.linkedinUrl && (
            <Button asChild variant="ghost" size="sm">
              <a href={target.linkedinUrl} target="_blank" rel="noreferrer">
                LinkedIn
              </a>
            </Button>
          )}
          <Button asChild variant="link" size="sm" className="ml-auto">
            <Link href={`/companies/${target.slug}`}>Full profile</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
