CREATE TABLE "company_source_identity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collector_id" uuid NOT NULL,
	"source_identifier" text NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_source_identity_collector_id_source_identifier_key" UNIQUE("collector_id","source_identifier")
);
--> statement-breakpoint
ALTER TABLE "collector" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "collector" ADD COLUMN "last_run_records_processed" integer;--> statement-breakpoint
ALTER TABLE "collector" ADD COLUMN "last_run_records_published" integer;--> statement-breakpoint
ALTER TABLE "collector" ADD COLUMN "last_run_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "company_source_identity" ADD CONSTRAINT "company_source_identity_collector_id_collector_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collector"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_source_identity" ADD CONSTRAINT "company_source_identity_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;