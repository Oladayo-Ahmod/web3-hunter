import { getDb, schema } from "@web3-hunter/db";
import { sql } from "drizzle-orm";
import { checkApplyEligibility, ELIGIBILITY_GATE_FINGERPRINT } from "./apply-eligibility";

/** Bounds memory and query size when there is a large backlog (first run, or after the gate's rules change). */
const REFRESH_BATCH_SIZE = 500;
/** Runaway guard: 200 batches is 100,000 Jobs, far beyond any real volume. */
const MAX_REFRESH_BATCHES = 200;

export interface JobEligibilityRefreshResult {
  /** How many Jobs had a verdict computed (new, changed, or evaluated under older rules). */
  evaluated: number;
}

/**
 * SQL condition: the stored verdict `je` applies to the Job's *current*
 * state (`ls`/`oj` `state_event_id`) under the *current* gate rules. Used as
 * part of the `job_eligibility` join in every reader, so a verdict that has
 * gone stale — the Job was updated, or the gate's phrase lists changed — is
 * ignored (treated as "not eligible yet") rather than trusted, until
 * `refreshJobEligibility` re-evaluates it. `je` is the alias for
 * `job_eligibility`; `jobAlias` is the alias of the Job's latest-state row,
 * which must expose `state_event_id`.
 */
export function jobEligibilityIsCurrent(jobAlias: "ls" | "oj") {
  return sql`je.state_event_id = ${sql.raw(`${jobAlias}.state_event_id`)} AND je.gate_fingerprint = ${ELIGIBILITY_GATE_FINGERPRINT}`;
}

type StaleJobRow = {
  state_event_id: string;
  company_id: string;
  external_id: string;
  title: string | null;
  description: string | null;
};

/**
 * Computes and stores the eligibility verdict for every *open* Job that
 * lacks a current one — see `job_eligibility`'s schema doc comment for why
 * this exists. Steady state this evaluates only what changed since the last
 * call (new postings, edited postings), so it reads a handful of
 * descriptions instead of the entire corpus; the first call after deploy,
 * or after the gate's rules change, evaluates everything once.
 *
 * Idempotent and safe to run concurrently: it is a pure function of the
 * Event log and the gate's rules, and writes are upserts.
 */
export async function refreshJobEligibility(): Promise<JobEligibilityRefreshResult> {
  const db = getDb();
  let evaluated = 0;

  for (let batch = 0; batch < MAX_REFRESH_BATCHES; batch += 1) {
    // Latest state per Job first (ids and keys only), then stale-detection
    // and the closed-Job exclusion, and only then join back to the Event for
    // title/description — so descriptions are only ever read for the Jobs
    // that actually need evaluating. `id DESC` makes the latest-state pick
    // deterministic when two Events share an `occurred_at`; every reader's
    // `latest_state` uses the same tie-break so they agree on it.
    const stale = await db.execute<StaleJobRow>(sql`
      WITH latest_state AS (
        SELECT DISTINCT ON (related_entity_id, metadata->>'externalId')
          id AS state_event_id,
          related_entity_id AS company_id,
          metadata->>'externalId' AS external_id,
          occurred_at AS state_at
        FROM event
        WHERE type IN ('JobPosted', 'JobUpdated') AND related_entity_type = 'company'
        ORDER BY related_entity_id, metadata->>'externalId', occurred_at DESC, id DESC
      ),
      needs_evaluation AS (
        SELECT ls.state_event_id, ls.company_id, ls.external_id
        FROM latest_state ls
        LEFT JOIN job_eligibility je
          ON je.company_id = ls.company_id AND je.external_id = ls.external_id
        WHERE (je.state_event_id IS DISTINCT FROM ls.state_event_id
               OR je.gate_fingerprint IS DISTINCT FROM ${ELIGIBILITY_GATE_FINGERPRINT})
          AND NOT EXISTS (
            SELECT 1 FROM event closed
            WHERE closed.type = 'JobClosed'
              AND closed.related_entity_type = 'company'
              AND closed.related_entity_id = ls.company_id
              AND closed.metadata->>'externalId' = ls.external_id
              AND closed.occurred_at >= ls.state_at
          )
        LIMIT ${REFRESH_BATCH_SIZE}
      )
      SELECT
        n.state_event_id, n.company_id, n.external_id,
        e.metadata->>'title' AS title,
        e.metadata->>'description' AS description
      FROM needs_evaluation n
      JOIN event e ON e.id = n.state_event_id
    `);

    if (stale.length === 0) {
      return { evaluated };
    }

    await db
      .insert(schema.jobEligibility)
      .values(
        stale.map((row) => {
          const verdict = checkApplyEligibility(row.title ?? "", row.description);
          return {
            companyId: row.company_id,
            externalId: row.external_id,
            stateEventId: row.state_event_id,
            gateFingerprint: ELIGIBILITY_GATE_FINGERPRINT,
            eligible: verdict.eligible,
            reasonCode: verdict.reasonCode,
          };
        }),
      )
      .onConflictDoUpdate({
        target: [schema.jobEligibility.companyId, schema.jobEligibility.externalId],
        set: {
          stateEventId: sql`excluded.state_event_id`,
          gateFingerprint: sql`excluded.gate_fingerprint`,
          eligible: sql`excluded.eligible`,
          reasonCode: sql`excluded.reason_code`,
          evaluatedAt: sql`now()`,
        },
      });

    evaluated += stale.length;
  }

  return { evaluated };
}

let inFlightRefresh: Promise<JobEligibilityRefreshResult> | null = null;

/**
 * What readers call before joining `job_eligibility`. Makes the read path
 * self-healing — a Job that landed since the last scheduled run is
 * evaluated on first sight instead of staying invisible until the next
 * one — without letting a failure here take a page down: verdicts that
 * already exist are still used. Concurrent callers in one process
 * (`/today` runs two readers at once) share a single refresh.
 */
export async function ensureJobEligibility(): Promise<void> {
  inFlightRefresh ??= refreshJobEligibility().finally(() => {
    inFlightRefresh = null;
  });

  try {
    await inFlightRefresh;
  } catch (error) {
    console.error("[job-eligibility] Refresh failed; continuing with stored verdicts:", error);
  }
}
