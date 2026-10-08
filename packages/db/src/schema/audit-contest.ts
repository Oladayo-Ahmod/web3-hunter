import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "../columns";
import { securityTarget } from "./security-target";

/**
 * An audit contest's lifecycle — intentionally minimal and closed, same
 * reasoning as `securityTargetStatus`.
 */
export const auditContestStatus = pgEnum("audit_contest_status", [
  "upcoming",
  "active",
  "completed",
]);

/**
 * An audit contest (e.g. a Code4rena/Sherlock/Cantina competition) —
 * curated/discovered reference data about a specific contest, not an
 * Opportunity itself. A `security_opportunity` of type `AUDIT_CONTEST`
 * may cite one of these as context, the same way `opportunity_skill`
 * cites Events as evidence, without this table being event-sourced
 * itself (there is no `AuditContestAnnounced`-equivalent Event Type
 * registered yet — see `security_target`'s doc comment for the same
 * reasoning).
 *
 * `securityTargetId` is nullable: a contest can be discovered before
 * the protocol it concerns has been resolved to a Security Target row.
 * `platform` is open text (e.g. "code4rena", "sherlock") — the set of
 * platforms is expected to grow, the same reasoning `collector.sourceType`
 * already uses. Reward amounts and the contest's repository are plain
 * text/URL fields rather than structured data, for the same reason
 * `company.fundingAmount` is free text: reported inconsistently
 * (ranges, "TBD", mixed currencies) and this is display/reference data,
 * never arithmetic, at this phase.
 */
export const auditContest = pgTable("audit_contest", {
  id: id(),
  securityTargetId: uuid("security_target_id").references(() => securityTarget.id),
  platform: text("platform").notNull(),
  title: text("title").notNull(),
  status: auditContestStatus("status").notNull().default("upcoming"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  repositoryUrl: text("repository_url"),
  rewardAmount: text("reward_amount"),
  // Where this contest was found — required provenance once a real
  // Collector exists; nullable for now since nothing populates it yet.
  sourceUrl: text("source_url"),
  ...timestamps(),
});
