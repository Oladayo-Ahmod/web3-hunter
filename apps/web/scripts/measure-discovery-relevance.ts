import { getDb, schema } from "@web3-hunter/db";
import { eq, sql } from "drizzle-orm";
import {
  computeJobRelevance,
  getViewerRelevanceProfile,
  type JobRelevanceProfile,
} from "@web3-hunter/application";

/**
 * Milestone 14's formalized discovery-quality measurement — the
 * repeatable version of the manual audit in
 * `docs/MILESTONE_14_DISCOVERY_QUALITY_REVIEW.md` §B/§G. Answers the one
 * question that milestone exists to answer: are jobs from *discovered*
 * companies actually relevant to the real saved Profile, not just
 * additional volume? Read-only — never mutates data, never probes an
 * ATS, never runs a collector. Safe to re-run at any time.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/measure-discovery-relevance.ts [email]
 *
 * `email` defaults to the product's one real user
 * (this is a single-user personal tool, not a multi-tenant product —
 * see docs/PRODUCT.md).
 */

const DEFAULT_USER_EMAIL = "oladayoahmod1122@gmail.com";

// Mirrors job-query-service.ts's `openJobsCte` exactly (including the
// Milestone 13 Phase C rejected-company filter) — kept in sync by hand,
// the same tradeoff `freshnessCondition`'s own doc comment already
// accepts, because this script needs the *entire* open-job pool
// unpaginated, which `listJobFeed` deliberately never returns in one call.
const OPEN_JOBS_CTE = sql`
  WITH latest_state AS (
    SELECT DISTINCT ON (related_entity_id, metadata->>'externalId')
      related_entity_id AS company_id, metadata->>'externalId' AS external_id, metadata, occurred_at AS state_at
    FROM event
    WHERE type IN ('JobPosted', 'JobUpdated') AND related_entity_type = 'company'
    ORDER BY related_entity_id, metadata->>'externalId', occurred_at DESC
  ),
  posted AS (
    SELECT related_entity_id AS company_id, metadata->>'externalId' AS external_id, MIN(occurred_at) AS posted_at
    FROM event WHERE type = 'JobPosted' AND related_entity_type = 'company' GROUP BY 1, 2
  ),
  closures AS (
    SELECT related_entity_id AS company_id, metadata->>'externalId' AS external_id, MAX(occurred_at) AS closed_at
    FROM event WHERE type = 'JobClosed' AND related_entity_type = 'company' GROUP BY 1, 2
  ),
  open_jobs AS (
    SELECT ls.company_id, ls.external_id, ls.metadata, ls.state_at, p.posted_at
    FROM latest_state ls
    JOIN posted p ON p.company_id = ls.company_id AND p.external_id = ls.external_id
    LEFT JOIN closures cl ON cl.company_id = ls.company_id AND cl.external_id = ls.external_id
    JOIN company c ON c.id = ls.company_id AND c.discovery_status != 'rejected'
    WHERE cl.closed_at IS NULL OR cl.closed_at < ls.state_at
  )
`;

type OpenJobRow = {
  company_id: string;
  external_id: string;
  metadata: {
    title: string;
    locationName: string | null;
    departmentNames: string[];
    workplaceType?: string | null;
  };
  company_slug: string;
  company_name: string;
  discovery_status: string;
};

type ScoredJob = {
  companySlug: string;
  discoveryStatus: string;
  collector: string;
  title: string;
  score: number;
  tier: string;
};

const TIERS = ["high", "medium", "low", "very-low"] as const;

function summarize(label: string, subset: ScoredJob[]): void {
  const n = subset.length;
  const counts: Record<string, number> = { high: 0, medium: 0, low: 0, "very-low": 0 };
  let sum = 0;
  for (const s of subset) {
    counts[s.tier] = (counts[s.tier] ?? 0) + 1;
    sum += s.score;
  }
  const pct = (k: string) => (n > 0 ? ((counts[k]! / n) * 100).toFixed(1) : "0.0");
  const usefulPct = n > 0 ? (((counts.high! + counts.medium!) / n) * 100).toFixed(1) : "0.0";
  console.log(
    `${label}: n=${n} avg=${n > 0 ? (sum / n).toFixed(1) : "n/a"} ` +
      `high=${counts.high} (${pct("high")}%) medium=${counts.medium} (${pct("medium")}%) ` +
      `low=${counts.low} very-low=${counts["very-low"]} | high+medium=${usefulPct}%`,
  );
}

async function main() {
  const db = getDb();
  const email = process.argv[2] ?? DEFAULT_USER_EMAIL;

  const [user] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  if (!user) {
    console.error(`No user found for ${email}`);
    process.exit(1);
  }

  const profile: JobRelevanceProfile | null = await getViewerRelevanceProfile(user.id);
  if (!profile) {
    console.error(`User ${email} has no saved Profile — nothing to score against`);
    process.exit(1);
  }

  const rows = await db.execute<OpenJobRow>(sql`
    ${OPEN_JOBS_CTE}
    SELECT oj.company_id, oj.external_id, oj.metadata, c.slug AS company_slug, c.name AS company_name, c.discovery_status
    FROM open_jobs oj JOIN company c ON c.id = oj.company_id
  `);

  const jobSkillRows = await db.select().from(schema.jobSkill);
  const skillsByKey = new Map<string, string[]>();
  for (const r of jobSkillRows) {
    const key = `${r.companyId}:${r.externalId}`;
    const existing = skillsByKey.get(key) ?? [];
    existing.push(r.skillId);
    skillsByKey.set(key, existing);
  }

  const sourceRows = await db.execute<{ slug: string; company_id: string }>(sql`
    SELECT cl.slug, csi.company_id FROM company_source_identity csi JOIN collector cl ON cl.id = csi.collector_id
  `);
  const collectorByCompanyId = new Map(sourceRows.map((r) => [r.company_id, r.slug]));

  const scored: ScoredJob[] = rows.map((row) => {
    const detectedSkillIds = skillsByKey.get(`${row.company_id}:${row.external_id}`) ?? [];
    const workplaceType =
      row.metadata.workplaceType === "remote" ||
      row.metadata.workplaceType === "hybrid" ||
      row.metadata.workplaceType === "onsite"
        ? row.metadata.workplaceType
        : null;
    const relevance = computeJobRelevance(
      {
        title: row.metadata.title,
        departmentNames: row.metadata.departmentNames,
        workplaceType,
        locationName: row.metadata.locationName,
      },
      detectedSkillIds,
      profile,
      new Map(),
    );
    return {
      companySlug: row.company_slug,
      discoveryStatus: row.discovery_status,
      collector: collectorByCompanyId.get(row.company_id) ?? "unknown",
      title: row.metadata.title,
      score: relevance.score,
      tier: relevance.tier,
    };
  });

  console.log(`=== Discovery relevance measurement (${new Date().toISOString()}) ===`);
  console.log(`Total open jobs (rejected companies excluded): ${scored.length}\n`);

  summarize(
    "curated",
    scored.filter((s) => s.discoveryStatus === "curated"),
  );
  summarize(
    "discovered",
    scored.filter((s) => s.discoveryStatus === "discovered"),
  );
  console.log();
  for (const platform of ["greenhouse", "lever", "ashby"]) {
    summarize(
      `discovered/${platform}`,
      scored.filter((s) => s.discoveryStatus === "discovered" && s.collector === platform),
    );
  }

  console.log("\n=== Sample discovered-company jobs now scoring medium/high ===");
  const usefulDiscovered = scored.filter(
    (s) => s.discoveryStatus === "discovered" && (s.tier === "high" || s.tier === "medium"),
  );
  for (const s of usefulDiscovered.slice(0, 20)) {
    console.log(`  [${s.tier}] ${s.companySlug}: "${s.title}" (score ${s.score})`);
  }

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
