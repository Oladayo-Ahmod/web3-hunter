import { timestamp, uuid } from "drizzle-orm/pg-core";
import { generateId } from "./id";

/**
 * Standard primary key column: a time-sortable UUIDv7 generated
 * application-side, per docs/DATABASE.md §4 ("Primary keys"). Every table in
 * this schema should use this helper rather than defining its own key.
 */
export function id() {
  return uuid("id").primaryKey().$defaultFn(generateId);
}

/**
 * Standard audit columns, per docs/DATABASE.md §4 ("Audit fields"). Every
 * canonical and derived table carries these at minimum.
 */
export function timestamps() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  };
}
