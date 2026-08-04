import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

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
 */
export const userProfile = pgTable("user_profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  dealBreakerSkillIds: uuid("deal_breaker_skill_ids").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
