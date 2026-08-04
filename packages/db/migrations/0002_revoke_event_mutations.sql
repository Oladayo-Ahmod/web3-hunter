-- Enforces docs/EVENT_MODEL.md's "Events are immutable" and "Events are
-- append-only" rules at the database level (per docs/DATABASE.md §5:
-- "the event store is append-only... not merely a rule engineers are
-- trusted to remember"), rather than relying solely on application-level
-- discipline.
--
-- Implemented as triggers rather than only REVOKE/GRANT: the runtime
-- database role this application will eventually connect with (a Supabase
-- project's application role) is not yet known at this stage of the
-- project — no live project has been provisioned yet, see
-- docs/DATABASE.md §9 Open Question #1 — so a trigger that
-- unconditionally rejects the operation is the one mechanism guaranteed
-- correct regardless of which role ends up connecting, without needing to
-- be revisited once that role is chosen. The REVOKE statements below are
-- kept as a second, defense-in-depth layer for whichever role is granted
-- access later.

CREATE OR REPLACE FUNCTION reject_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'The % table is append-only: % is not permitted. See docs/EVENT_MODEL.md, "Events are immutable".',
    TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER event_no_update
  BEFORE UPDATE ON "event"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

CREATE TRIGGER event_no_delete
  BEFORE DELETE ON "event"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

CREATE TRIGGER event_provenance_no_update
  BEFORE UPDATE ON "event_provenance"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

CREATE TRIGGER event_provenance_no_delete
  BEFORE DELETE ON "event_provenance"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

REVOKE UPDATE, DELETE ON "event", "event_provenance" FROM PUBLIC;
