ALTER TABLE "raw_record" ADD COLUMN "source_identifier" text;--> statement-breakpoint
CREATE INDEX "raw_record_source_identifier_idx" ON "raw_record" USING btree ("collector_id","source_identifier");