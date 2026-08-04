-- Extends the same append-only enforcement from
-- 0002_revoke_event_mutations.sql and 0004_revoke_raw_record_mutations.sql
-- to signal and signal_generation_ledger: a Signal's detection is an
-- immutable historical fact (see docs/DOMAIN_MODEL.md §Signal and
-- docs/DATABASE.md §2). company_intelligence and opportunity are
-- deliberately NOT covered here — per the approved Milestone 3
-- refinement, they are mutable, rebuildable projections over
-- IntelligenceUpdated/OpportunityDetected/OpportunityScored Events, not
-- canonical stores themselves.

CREATE TRIGGER signal_no_update
  BEFORE UPDATE ON "signal"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

CREATE TRIGGER signal_no_delete
  BEFORE DELETE ON "signal"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

CREATE TRIGGER signal_generation_ledger_no_update
  BEFORE UPDATE ON "signal_generation_ledger"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

CREATE TRIGGER signal_generation_ledger_no_delete
  BEFORE DELETE ON "signal_generation_ledger"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

REVOKE UPDATE, DELETE ON "signal", "signal_generation_ledger" FROM PUBLIC;
