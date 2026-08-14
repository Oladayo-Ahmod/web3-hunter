import { pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "../columns";
import { company } from "./company";

/**
 * A closed vocabulary, same reasoning as `companyCategory`/`companyPriority`
 * — grows only by addition. Deliberately prefers technical roles: the
 * whole point of this table (Milestone 16 §10, "prefer technical
 * decision-makers... do NOT give me generic HR contacts") is surfacing who
 * to actually reach out to at an early-stage company, not a generic
 * "careers" inbox.
 */
export const companyContactRole = pgEnum("company_contact_role", [
  "founder",
  "cofounder",
  "cto",
  "head_of_engineering",
  "security_lead",
  "protocol_lead",
  "other",
]);

/**
 * A named, individually-verifiable person worth contacting at a Company —
 * Milestone 16/17's outreach-target requirement. Deliberately minimal:
 * one row per real person, with the one strongest public profile link
 * available, not a full contact-management system. `name` and
 * `profileUrl` are both required — a row only exists here because it was
 * actually found and verified; there is no "unknown contact" placeholder
 * (docs/MILESTONE_16... §14, "no invented founders").
 *
 * Curated the same way the Company directory itself is
 * (`packages/db/src/seed/company-directory.ts`) — hand-authored,
 * idempotently upserted, not event-sourced or discovered.
 */
export const companyContact = pgTable("company_contact", {
  id: id(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => company.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  role: companyContactRole("role").notNull(),
  // e.g. "https://x.com/...", "https://linkedin.com/in/..." — the
  // strongest publicly verifiable profile link found, not a guess.
  profileUrl: text("profile_url").notNull(),
  notes: text("notes"),
  ...timestamps(),
});
