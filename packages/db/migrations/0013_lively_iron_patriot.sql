CREATE TABLE "company_technology_profile" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"skill_ids" uuid[] DEFAULT '{}' NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "technology_detection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"confidence" double precision NOT NULL,
	"reasoning" text NOT NULL,
	"source_event_ids" uuid[] NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "technology_detection_confidence_range" CHECK ("technology_detection"."confidence" >= 0 AND "technology_detection"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "technology_detection_ledger" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"technologies_detected" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "matched_technology_skill_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_technology_profile" ADD CONSTRAINT "company_technology_profile_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technology_detection" ADD CONSTRAINT "technology_detection_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technology_detection" ADD CONSTRAINT "technology_detection_skill_id_skill_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skill"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technology_detection_ledger" ADD CONSTRAINT "technology_detection_ledger_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "technology_detection_company_id_idx" ON "technology_detection" USING btree ("company_id");