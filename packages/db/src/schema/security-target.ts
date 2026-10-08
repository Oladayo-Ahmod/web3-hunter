import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "../columns";
import { company, companyCategory } from "./company";

/**
 * A Security Target's tracking state — intentionally minimal (two
 * values) for Phase 1. Mirrors `collectorStatus`'s "closed vocabulary,
 * grows by addition" reasoning, not `company`'s richer lifecycle
 * (Discovered/Tracked/Dormant/Merged): there is no collector yet driving
 * transitions, so a finer-grained lifecycle would be speculative.
 */
export const securityTargetStatus = pgEnum("security_target_status", ["active", "inactive"]);

/**
 * A protocol or project that is a subject of security research — a
 * distinct real-world concept from `company` (an organization that
 * hires), not a subtype of it. One organization may have several
 * protocols (e.g. Uniswap Labs -> Uniswap V2/V3/V4, each with its own
 * audit history); plenty of audit-worthy protocols have no identifiable
 * hiring organization at all. See docs/ARCHITECTURE.md's Company ≠
 * Opportunity precedent for why conflating adjacent-but-distinct domain
 * concepts into one table is treated as a modeling defect here.
 *
 * `companyId` is the only link to the existing hiring vertical, and it is
 * optional: set when this protocol's organization is also tracked as a
 * Company, null otherwise. Everything else on `company` (careers page,
 * funding stage, outreach priority) is deliberately not reachable from
 * here — this table reuses the identity link, not the hiring-specific
 * shape.
 *
 * Deliberately minimal for Phase 1 — see the Security domain foundation
 * proposal. Not included, and deferred until there is a real producer:
 * deployed-contract/chain-deployment tracking (inherently one-to-many,
 * would need its own table rather than a column here), security contact
 * information (mirrors `company_contact`'s shape if/when needed), and
 * audit-history/bug-bounty-status — both already modeled as their own
 * tables (`audit_contest`, `bug_bounty`) rather than columns here, per
 * "prefer normalized, composable domain entities."
 */
export const securityTarget = pgTable("security_target", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  companyId: uuid("company_id").references(() => company.id),
  repositoryUrl: text("repository_url"),
  // Free text (e.g. "Ethereum", "Arbitrum", "multi-chain") rather than a
  // structured one-to-many deployment model — a single primary
  // chain/ecosystem identifier is enough to reason about until a real
  // source of multi-chain deployment data exists.
  chain: text("chain"),
  category: companyCategory("category"),
  status: securityTargetStatus("status").notNull().default("active"),
  // Which discovery channel found it, e.g. "code4rena-contest" — null
  // until a real Collector exists. Mirrors `company.discoverySource`.
  discoverySource: text("discovery_source"),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }),
  ...timestamps(),
});
