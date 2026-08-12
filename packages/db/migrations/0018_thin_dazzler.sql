CREATE TYPE "public"."company_discovery_status" AS ENUM('curated', 'discovered', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."company_discovery_probe_result" AS ENUM('hit', 'miss');--> statement-breakpoint
CREATE TABLE "company_discovery_probe" (
	"id" uuid PRIMARY KEY NOT NULL,
	"candidate_name" text NOT NULL,
	"candidate_slug" text NOT NULL,
	"collector_slug" text NOT NULL,
	"result" "company_discovery_probe_result" NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_company_id" uuid,
	CONSTRAINT "company_discovery_probe_candidate_slug_collector_slug_key" UNIQUE("candidate_slug","collector_slug")
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "discovery_status" "company_discovery_status" DEFAULT 'discovered' NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "discovery_source" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "discovered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "last_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_discovery_probe" ADD CONSTRAINT "company_discovery_probe_resolved_company_id_company_id_fk" FOREIGN KEY ("resolved_company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- One-time backfill: every Company that existed before this migration was
-- added by hand via apps/web/data/companies/*.json, not discovered by a
-- probe - the new column's "discovered" default would be factually wrong
-- for these rows if left unset. Every Company created after this
-- migration runs gets the correct value at insert time (curated seeding
-- sets it explicitly; packages/db/src/discovery/company-resolution.ts
-- sets it explicitly) - this UPDATE only ever needs to run once.
UPDATE "company" SET "discovery_status" = 'curated';