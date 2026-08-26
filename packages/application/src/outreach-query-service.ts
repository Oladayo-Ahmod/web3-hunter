import { getDb } from "@web3-hunter/db";
import { sql } from "drizzle-orm";
import { checkApplyEligibility } from "./apply-eligibility";
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
 *
 * Milestone 24: "open role" now means an *eligible* open role, not any
 * open posting — before this, a Company whose only open job was e.g.
 * "VP of Sales" was classified OPEN_ROLE and showed that irrelevant
 * title as its "reason to contact," exactly the "Outreach is basically
 * a job board with no relevance filter" bug (governing directive, Part
 * 4/7). This reuses `apply-eligibility.ts`'s gate — the same one
 * `/jobs`/`/today` already use — so there is one canonical eligibility
 * layer, not a second slightly-different one (Part 4's explicit
 * instruction). Company relevance is untouched: every curated Company
 * still appears here regardless of whether it has any eligible role —
 * it just falls through to DM/Research instead of Apply (Part 6).
 */
export async function listOutreachTargets(): Promise<OutreachTargetDTO[]> {
  const db = getDb();

  const companyRows = await db.execute<{
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
    contacts: CompanyContactDTO[];
  }>(sql`
    WITH contacts_agg AS (
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
      COALESCE(ca.contacts, '[]'::json) AS contacts
    FROM company c
    LEFT JOIN contacts_agg ca ON ca.company_id = c.id
    WHERE c.discovery_status IN ('curated', 'verified')
    ORDER BY
      -- Milestone 19 §2's "startup bias": a hand-curated 'high' priority
      -- Company sorts before 'medium', before 'low', before an
      -- unclassified one (most of the original, pre-Milestone-17
      -- directory — large, well-known incumbents like Coinbase/Kraken
      -- among them) — free, since priority already exists as exactly
      -- this signal; no new column, no scoring formula.
      CASE c.priority
        WHEN 'high' THEN 0
        WHEN 'medium' THEN 1
        WHEN 'low' THEN 2
        ELSE 3
      END,
      c.name ASC
  `);

  // Raw open-job rows across every curated/verified Company — title and
  // description only, the two fields `checkApplyEligibility` needs.
  // Filtered in JS (same reason `job-query-service.ts`'s default view
  // is: the gate is a regex-over-title/description function, not a SQL
  // expression), then aggregated per Company below.
  const jobRows = await db.execute<{
    company_id: string;
    title: string;
    description: string | null;
  }>(sql`
    WITH latest_state AS (
      SELECT DISTINCT ON (related_entity_id, metadata->>'externalId')
        related_entity_id AS company_id,
        metadata->>'externalId' AS external_id,
        metadata,
        occurred_at AS state_at
      FROM event
      WHERE type IN ('JobPosted', 'JobUpdated') AND related_entity_type = 'company'
      ORDER BY related_entity_id, metadata->>'externalId', occurred_at DESC
    )
    SELECT
      ls.company_id,
      ls.metadata->>'title' AS title,
      ls.metadata->>'description' AS description
    FROM latest_state ls
    JOIN company c ON c.id = ls.company_id AND c.discovery_status IN ('curated', 'verified')
    WHERE NOT EXISTS (
      SELECT 1 FROM event closed
      WHERE closed.type = 'JobClosed'
        AND closed.related_entity_type = 'company'
        AND closed.related_entity_id = ls.company_id
        AND closed.metadata->>'externalId' = ls.external_id
        AND closed.occurred_at >= ls.state_at
    )
  `);

  const eligibleByCompany = new Map<string, string[]>();
  for (const row of jobRows) {
    if (!checkApplyEligibility(row.title, row.description).eligible) {
      continue;
    }
    const titles = eligibleByCompany.get(row.company_id) ?? [];
    titles.push(row.title);
    eligibleByCompany.set(row.company_id, titles);
  }

  return companyRows.map((row) => {
    const eligibleTitles = (eligibleByCompany.get(row.id) ?? []).sort((a, b) => a.localeCompare(b));
    const openJobCount = eligibleTitles.length;
    const opportunityType = classifyOpportunityType(
      openJobCount,
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
      openJobCount,
      openJobTitles: eligibleTitles.slice(0, 3),
      reasonToContact: buildReasonToContact(row.name, opportunityType, {
        openJobCount,
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
