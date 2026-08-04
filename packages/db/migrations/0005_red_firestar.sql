ALTER TABLE "raw_record" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE INDEX "raw_record_external_id_idx" ON "raw_record" USING btree ("collector_id","external_id");