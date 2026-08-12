CREATE TYPE "public"."remote_preference" AS ENUM('remote_only', 'remote_friendly', 'no_preference');--> statement-breakpoint
CREATE TABLE "job_classification_ledger" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"classifications_produced" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_skill" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"skill_id" uuid NOT NULL,
	"confidence" double precision NOT NULL,
	"reasoning" text NOT NULL,
	"source_event_ids" uuid[] NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_skill_company_id_external_id_skill_id_key" UNIQUE("company_id","external_id","skill_id"),
	CONSTRAINT "job_skill_confidence_range" CHECK ("job_skill"."confidence" >= 0 AND "job_skill"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "target_role_slugs" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "remote_preference" "remote_preference";--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "location_constraint" text;--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "seniority_preference" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_classification_ledger" ADD CONSTRAINT "job_classification_ledger_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_skill" ADD CONSTRAINT "job_skill_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_skill" ADD CONSTRAINT "job_skill_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_skill_company_id_external_id_idx" ON "job_skill" USING btree ("company_id","external_id");