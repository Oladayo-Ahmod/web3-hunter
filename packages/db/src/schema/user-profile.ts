import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * A User's remote-work preference (Milestone 13 Phase 2). Deliberately a
 * small, closed enum — the same choice `companyCategory`/`eventCategory`
 * made for their own small, rarely-changing vocabularies — not a seeded
 * lookup table like `skill`, and not free text like `locationConstraint`
 * below, since this one has a fixed, known set of meanings the relevance
 * scorer branches on (`packages/application/src/job-relevance.ts`).
 */
export const remotePreference = pgEnum("remote_preference", [
  "remote_only",
  "remote_friendly",
  "no_preference",
]);

/**
 * The User Profile (docs/DOMAIN_MODEL.md §User Profile): the domain data
 * used for matching, distinct from `user`'s account/identity concerns —
 * the User ≠ User Profile distinction in docs/DOMAIN_MODEL.md's Ubiquitous
 * Language. One-to-one with `user`; Skills are a separate table
 * (`user_skill`) since a User has many.
 *
 * `dealBreakerSkillIds` is the one deal-breaker mechanism grounded in real
 * data as of Milestone 5 — company-stage deal-breakers from
 * docs/DOMAIN_MODEL.md's example are deferred until `company` carries a
 * stage field (see the Milestone 5 Definition of Ready). An Opportunity
 * tagged with any of these Skills is excluded from that User's Matches
 * entirely — a hard filter, never a soft signal a score can outweigh, per
 * the same invariant.
 *
 * Milestone 13 Phase 2 adds the job-hunt preference fields below, for
 * `packages/application/src/job-relevance.ts`'s per-Job scorer. Every one
 * of them is optional/defaulted-empty and every relevance component that
 * reads them treats "not set" as "no opinion, don't penalize" — never as
 * an implicit mismatch (see that module's doc comment).
 */
export const userProfile = pgTable("user_profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  dealBreakerSkillIds: uuid("deal_breaker_skill_ids").array().notNull().default([]),
  // Free-text slugs, not a foreign key into a taxonomy table: unlike
  // Skill (shared, reused across User Profile and Opportunity/Job
  // tagging), target roles are only ever compared against a job's own
  // title text (see `job-relevance.ts`'s `ROLE_TITLE_KEYWORDS`) — there's
  // nothing else in the system that would join against a `role` table.
  targetRoleSlugs: text("target_role_slugs").array().notNull().default([]),
  remotePreference: remotePreference("remote_preference"),
  // Free text, e.g. "Worldwide", "USA", "EU" — mirrors `company
  // .headquarters`'s own precedent (sparse, best-effort, not worth a
  // structured location model yet).
  locationConstraint: text("location_constraint"),
  // Free-text values (e.g. "junior", "mid", "senior") rather than an enum:
  // unlike `remotePreference`, a User may reasonably select more than one
  // and the set of meaningful levels is still being figured out — an enum
  // here would mean a migration every time that vocabulary needs to grow.
  seniorityPreference: text("seniority_preference").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
