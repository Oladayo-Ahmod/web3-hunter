import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "../columns";
import { user } from "./auth";

/**
 * The Skill taxonomy (docs/DOMAIN_MODEL.md §Skill): a shared, closed
 * vocabulary — not free text — referenced by both a User Profile's
 * declared Skills and `packages/classification`'s Opportunity Skill tags,
 * which is what makes a Match's Skill-overlap comparison meaningful.
 * Owned here, in `packages/db`, since it is genuinely shared reference
 * data rather than belonging to either consuming package.
 */
export const skill = pgTable("skill", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

/**
 * A User's self-declared Skills — the canonical input to Match
 * computation, per docs/DOMAIN_MODEL.md §User Profile's invariant that a
 * Resume, if present, never overrides it.
 */
export const userSkill = pgTable(
  "user_skill",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.skillId] })],
);
