-- Extends the same append-only enforcement from
-- 0002_revoke_event_mutations.sql to raw_record and raw_record_ingestion,
-- per docs/EVENT_MODEL.md's redefinition of a Raw Record as "immutable,
-- persisted" (see ARCHITECTURE.md §3, packages/ingestion). Reuses
-- reject_event_mutation() rather than redefining an identical function —
-- it already raises generically using TG_TABLE_NAME/TG_OP.

CREATE TRIGGER raw_record_no_update
  BEFORE UPDATE ON "raw_record"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

CREATE TRIGGER raw_record_no_delete
  BEFORE DELETE ON "raw_record"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

CREATE TRIGGER raw_record_ingestion_no_update
  BEFORE UPDATE ON "raw_record_ingestion"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

CREATE TRIGGER raw_record_ingestion_no_delete
  BEFORE DELETE ON "raw_record_ingestion"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

REVOKE UPDATE, DELETE ON "raw_record", "raw_record_ingestion" FROM PUBLIC;
