import { getDb } from "@web3-hunter/db";
import { sql } from "drizzle-orm";
import type {
  CompanyContactDTO,
  CompanyPriorityDTO,
  OpportunityTypeDTO,
  OutreachTargetDTO,
} from "./dto";

/**
 * The Outreach Target list — Milestone 17's "who should I contact today"
 * read model (docs: the app's actual job-hunting objective is a large,
 * continuously-useful pool of Web3-native companies to apply to or DM,
 * not a maximal job count). A deliberately separate, small service from
 * `company-query-service.ts` — that file backs the company-intelligence/
 * signal/match subsystem; this one answers a different, simpler
 * question and has no need for that subsystem's concepts.
 *
 * Scoped to `discoveryStatus IN ('curated', 'verified')` — i.e. every
 * Company a human (a directory entry author, or a later verification
 * pass) has vouched for — and excludes `rejected` and plain `discovered`
 * Companies. `discovered` Companies come from ATS/DeFiLlama probing
 * without individual verification (Milestone 15's own conclusion: probe
 * volume without curation produces false positives); this view's whole
 * purpose is a trustworthy outreach list, so it deliberately doesn't
 * include them.
 */
export async function listOutreachTargets(): Promise<OutreachTargetDTO[]> {
  const db = getDb();

  const rows = await db.execute<{
    id: string;
    slug: string;
    name: string;
    website_url: string | null;
    careers_page_url: string | null;
    twitter_url: string | null;
    linkedin_url: string | null;
    description: string | null;
    category: string | null;
    tags: string[] | null;
    priority: CompanyPriorityDTO | null;
    funding_stage: string | null;
    recently_funded: boolean;
    funding_date: string | null;
    funding_amount: string | null;
    funding_source: string | null;
    open_job_count: number;
    open_job_titles: string[] | null;
    contacts: CompanyContactDTO[];
  }>(sql`
    WITH open_jobs AS (
      SELECT related_entity_id AS company_id, metadata->>'externalId' AS external_id, metadata->>'title' AS title
      FROM (
        SELECT DISTINCT ON (related_entity_id, metadata->>'externalId')
          related_entity_id,
          metadata->>'externalId' AS external_id,
          metadata,
          occurred_at AS state_at
        FROM event
        WHERE type IN ('JobPosted', 'JobUpdated') AND related_entity_type = 'company'
        ORDER BY related_entity_id, metadata->>'externalId', occurred_at DESC
      ) latest_state
      WHERE NOT EXISTS (
        SELECT 1 FROM event closed
        WHERE closed.type = 'JobClosed'
          AND closed.related_entity_type = 'company'
          AND closed.related_entity_id = latest_state.related_entity_id
          AND closed.metadata->>'externalId' = latest_state.external_id
          AND closed.occurred_at >= latest_state.state_at
      )
    ),
    open_job_counts AS (
      SELECT company_id, COUNT(*)::int AS open_job_count
      FROM open_jobs
      GROUP BY company_id
    ),
    -- Up to 3 open titles per Company (Milestone 18 outreach card's
    -- "role if available") — a lightweight json_agg over a row-limited
    -- subquery, not a join to the full Job Feed read model; this view
    -- only ever needs a handful of representative titles, not every
    -- field a /jobs card carries.
    open_job_titles_agg AS (
      SELECT company_id, json_agg(title) AS titles
      FROM (
        SELECT company_id, title, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY title) AS rn
        FROM open_jobs
      ) ranked
      WHERE rn <= 3
      GROUP BY company_id
    ),
    contacts_agg AS (
      SELECT
        company_id,
        json_agg(
          json_build_object('name', name, 'role', role, 'profileUrl', profile_url, 'notes', notes)
          ORDER BY
            CASE role
              WHEN 'founder' THEN 0
              WHEN 'cofounder' THEN 1
              WHEN 'cto' THEN 2
              WHEN 'head_of_engineering' THEN 3
              WHEN 'security_lead' THEN 4
              WHEN 'protocol_lead' THEN 5
              ELSE 6
            END
        ) AS contacts
      FROM company_contact
      GROUP BY company_id
    )
    SELECT
      c.id, c.slug, c.name, c.website_url, c.careers_page_url, c.twitter_url, c.linkedin_url,
      c.description, c.category, c.tags, c.priority, c.funding_stage,
      c.recently_funded, c.funding_date, c.funding_amount, c.funding_source,
      COALESCE(ojc.open_job_count, 0) AS open_job_count,
      COALESCE(ojt.titles, '[]'::json) AS open_job_titles,
      COALESCE(ca.contacts, '[]'::json) AS contacts
    FROM company c
    LEFT JOIN open_job_counts ojc ON ojc.company_id = c.id
    LEFT JOIN open_job_titles_agg ojt ON ojt.company_id = c.id
    LEFT JOIN contacts_agg ca ON ca.company_id = c.id
    WHERE c.discovery_status IN ('curated', 'verified')
    ORDER BY c.name ASC
  `);

  return rows.map((row) => {
    const opportunityType = classifyOpportunityType(
      row.open_job_count,
      row.priority,
      row.recently_funded,
    );
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      websiteUrl: row.website_url,
      careersPageUrl: row.careers_page_url,
      twitterUrl: row.twitter_url,
      linkedinUrl: row.linkedin_url,
      description: row.description,
      category: row.category,
      tags: row.tags ?? [],
      priority: row.priority,
      fundingStage: row.funding_stage,
      recentlyFunded: row.recently_funded,
      fundingDate: row.funding_date,
      fundingAmount: row.funding_amount,
      fundingSource: row.funding_source,
      opportunityType,
      openJobCount: row.open_job_count,
      openJobTitles: row.open_job_titles ?? [],
      reasonToContact: buildReasonToContact(row.name, opportunityType, {
        openJobCount: row.open_job_count,
        fundingStage: row.funding_stage,
        fundingAmount: row.funding_amount,
      }),
      contacts: row.contacts,
    };
  });
}

/**
 * The fixed precedence behind `OutreachTargetDTO.opportunityType` — an
 * open role beats every other reason to reach out (it's the most direct,
 * fastest path: apply now), then a verified recent-funding event, then a
 * curator's "high priority" judgment call, and anything curated that
 * clears none of those is still worth a proactive outreach. Explicit
 * `if`/`else if` chain, not a scoring formula — Milestone 16 §9's "do not
 * pretend these are scientifically precise" applies here too.
 *
 * Milestone 18: keys off the explicit `recentlyFunded` boolean, not mere
 * presence of `fundingStage` text — `fundingStage` (e.g. "Series A") is
 * often known for a Company funded years ago, which is not the timely,
 * outreach-worthy signal this bucket exists for.
 */
export function classifyOpportunityType(
  openJobCount: number,
  priority: CompanyPriorityDTO | null,
  recentlyFunded: boolean,
): OpportunityTypeDTO {
  if (openJobCount > 0) {
    return "OPEN_ROLE";
  }
  if (recentlyFunded) {
    return "RECENTLY_FUNDED";
  }
  if (priority === "high") {
    return "HIGH_PRIORITY_STARTUP";
  }
  return "SPECULATIVE_OUTREACH";
}

/**
 * A short, deterministic sentence explaining why a Company is on the
 * list today (Milestone 18 §9's "reason to contact") — plain string
 * interpolation over already-known facts, never AI-generated and never a
 * new scoring input; purely a rendering of `classifyOpportunityType`'s
 * own decision back into words.
 */
function buildReasonToContact(
  companyName: string,
  opportunityType: OpportunityTypeDTO,
  facts: { openJobCount: number; fundingStage: string | null; fundingAmount: string | null },
): string {
  switch (opportunityType) {
    case "OPEN_ROLE":
      return facts.openJobCount === 1
        ? `${companyName} has 1 open role matching your profile — apply directly.`
        : `${companyName} has ${facts.openJobCount} open roles matching your profile — apply directly.`;
    case "RECENTLY_FUNDED":
      return facts.fundingAmount
        ? `${companyName} recently raised ${facts.fundingAmount}${facts.fundingStage ? ` (${facts.fundingStage})` : ""} — good timing to reach out before roles are posted.`
        : `${companyName} recently raised funding${facts.fundingStage ? ` (${facts.fundingStage})` : ""} — good timing to reach out before roles are posted.`;
    case "HIGH_PRIORITY_STARTUP":
      return `${companyName} is a high-priority early-stage Web3 startup — worth a direct message to the founder or CTO even without a posted role.`;
    case "SPECULATIVE_OUTREACH":
      return `${companyName} is a verified Web3-native company — worth introducing yourself even without a posted role.`;
  }
}
