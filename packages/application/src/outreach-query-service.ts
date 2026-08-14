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
    open_job_count: number;
    contacts: CompanyContactDTO[];
  }>(sql`
    WITH open_job_counts AS (
      SELECT related_entity_id AS company_id, COUNT(*)::int AS open_job_count
      FROM (
        SELECT DISTINCT ON (related_entity_id, metadata->>'externalId')
          related_entity_id,
          metadata->>'externalId' AS external_id,
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
      GROUP BY related_entity_id
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
      COALESCE(ojc.open_job_count, 0) AS open_job_count,
      COALESCE(ca.contacts, '[]'::json) AS contacts
    FROM company c
    LEFT JOIN open_job_counts ojc ON ojc.company_id = c.id
    LEFT JOIN contacts_agg ca ON ca.company_id = c.id
    WHERE c.discovery_status IN ('curated', 'verified')
    ORDER BY c.name ASC
  `);

  return rows.map((row) => ({
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
    opportunityType: classifyOpportunityType(row.open_job_count, row.priority, row.funding_stage),
    openJobCount: row.open_job_count,
    contacts: row.contacts,
  }));
}

/**
 * The fixed precedence behind `OutreachTargetDTO.opportunityType` — an
 * open role beats every other reason to reach out (it's the most direct,
 * fastest path: apply now), then a stated recent funding round, then a
 * curator's "high priority" judgment call, and anything curated that
 * clears none of those is still worth a speculative outreach. Explicit
 * `if`/`else if` chain, not a scoring formula — Milestone 16 §9's "do not
 * pretend these are scientifically precise" applies here too.
 */
export function classifyOpportunityType(
  openJobCount: number,
  priority: CompanyPriorityDTO | null,
  fundingStage: string | null,
): OpportunityTypeDTO {
  if (openJobCount > 0) {
    return "OPEN_ROLE";
  }
  if (fundingStage) {
    return "RECENTLY_FUNDED";
  }
  if (priority === "high") {
    return "HIGH_PRIORITY_STARTUP";
  }
  return "SPECULATIVE_OUTREACH";
}
