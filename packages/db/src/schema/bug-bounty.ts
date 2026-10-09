import { pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "../columns";
import { securityTarget } from "./security-target";

/**
 * A bug bounty program's lifecycle — intentionally minimal and closed,
 * same reasoning as `securityTargetStatus`/`auditContestStatus`.
 */
export const bugBountyStatus = pgEnum("bug_bounty_status", ["active", "paused", "closed"]);

/**
 * A bug bounty program (e.g. on Immunefi or HackenProof) — curated/
 * discovered reference data about a specific program, not an
 * Opportunity itself, the same relationship `audit_contest` has to
 * `security_opportunity` (see that table's doc comment).
 *
 * `scopeUrl` and `disclosureUrl` are plain URL references rather than
 * structured scope/channel modeling — scope definitions and disclosure
 * processes vary enough across platforms that a link to the program's
 * own page is the accurate, minimal representation; modeling their
 * internal structure now would be guessing a taxonomy ahead of any real
 * source.
 */
export const bugBounty = pgTable(
  "bug_bounty",
  {
    id: id(),
    securityTargetId: uuid("security_target_id").references(() => securityTarget.id),
    platform: text("platform").notNull(),
    status: bugBountyStatus("status").notNull().default("active"),
    maxRewardAmount: text("max_reward_amount"),
    scopeUrl: text("scope_url"),
    disclosureUrl: text("disclosure_url"),
    sourceUrl: text("source_url"),
    ...timestamps(),
  },
  (table) => [
    // Assumes one tracked program per (Security Target, platform) — true
    // in practice for Immunefi (verified: 232/232 programs have unique
    // slugs, none repeated). A platform that lists multiple concurrent
    // programs for the same protocol would need a richer key; no such
    // source exists yet. NULL `securityTargetId` rows (not yet resolved)
    // are exempt from this constraint, per Postgres's standard NULL
    // handling in unique indexes.
    unique("bug_bounty_security_target_id_platform_key").on(table.securityTargetId, table.platform),
  ],
);
