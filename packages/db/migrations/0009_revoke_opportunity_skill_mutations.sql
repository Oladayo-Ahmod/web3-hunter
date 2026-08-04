-- Extends the same append-only enforcement from 0002/0004/0007 to
-- opportunity_skill and classification_ledger: a classification's
-- detection is an immutable historical fact (see docs/DOMAIN_MODEL.md
-- §Skill and docs/DATABASE.md §2), the same reasoning as signal /
-- signal_generation_ledger. user_profile, user_skill, and match are
-- deliberately NOT covered here: user_skill is a User's directly-editable
-- declared Skill list (not a derived fact), and match is a mutable,
-- rebuildable projection over MatchComputed Events, per the same pattern
-- established for company_intelligence/opportunity in Milestone 3.

CREATE TRIGGER opportunity_skill_no_update
  BEFORE UPDATE ON "opportunity_skill"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

CREATE TRIGGER opportunity_skill_no_delete
  BEFORE DELETE ON "opportunity_skill"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

CREATE TRIGGER classification_ledger_no_update
  BEFORE UPDATE ON "classification_ledger"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

CREATE TRIGGER classification_ledger_no_delete
  BEFORE DELETE ON "classification_ledger"
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
--> statement-breakpoint

REVOKE UPDATE, DELETE ON "opportunity_skill", "classification_ledger" FROM PUBLIC;
