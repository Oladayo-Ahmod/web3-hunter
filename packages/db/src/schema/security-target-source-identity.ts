import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id } from "../columns";
import { collector } from "./collector";
import { securityTarget } from "./security-target";

/**
 * The explicit, auditable record of cross-source Security Target identity
 * resolution — mirrors `company_source_identity` exactly (see that
 * table's doc comment), scoped to `security_target` instead of `company`.
 *
 * `security_target.slug` is a canonical, source-agnostic identifier, the
 * same role `company.slug` plays — it is not itself a safe cross-source
 * join key. A row here means "this Collector's own identifier for a
 * protocol (e.g. DefiLlama's own `slug`) has been declared to refer to
 * this Security Target," so resolving the same Collector + identifier
 * pair again always recovers the same Security Target deterministically,
 * regardless of poll order, instead of relying on the global `slug`
 * column alone to disambiguate.
 */
export const securityTargetSourceIdentity = pgTable(
  "security_target_source_identity",
  {
    id: id(),
    collectorId: uuid("collector_id")
      .notNull()
      .references(() => collector.id),
    // This Collector's own identifier for the protocol (e.g. DefiLlama's
    // own `slug`) — the source-specific half of the mapping.
    // `security_target.slug` is the canonical, cross-source half.
    sourceIdentifier: text("source_identifier").notNull(),
    securityTargetId: uuid("security_target_id")
      .notNull()
      .references(() => securityTarget.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("security_target_source_identity_collector_id_source_identifier_key").on(
      table.collectorId,
      table.sourceIdentifier,
    ),
  ],
);
