CREATE TYPE "public"."audit_contest_status" AS ENUM('upcoming', 'active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."bug_bounty_status" AS ENUM('active', 'paused', 'closed');--> statement-breakpoint
CREATE TYPE "public"."security_target_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "audit_contest" (
	"id" uuid PRIMARY KEY NOT NULL,
	"security_target_id" uuid,
	"platform" text NOT NULL,
	"title" text NOT NULL,
	"status" "audit_contest_status" DEFAULT 'upcoming' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"repository_url" text,
	"reward_amount" text,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bug_bounty" (
	"id" uuid PRIMARY KEY NOT NULL,
	"security_target_id" uuid,
	"platform" text NOT NULL,
	"status" "bug_bounty_status" DEFAULT 'active' NOT NULL,
	"max_reward_amount" text,
	"scope_url" text,
	"disclosure_url" text,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_opportunity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"security_target_id" uuid NOT NULL,
	"opportunity_type" text NOT NULL,
	"detection_window" text NOT NULL,
	"status" "opportunity_status" DEFAULT 'detected' NOT NULL,
	"score" double precision,
	"reasoning" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"scored_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_opportunity_target_type_window_key" UNIQUE("security_target_id","opportunity_type","detection_window"),
	CONSTRAINT "security_opportunity_score_range" CHECK ("security_opportunity"."score" IS NULL OR ("security_opportunity"."score" >= 0 AND "security_opportunity"."score" <= 1))
);
--> statement-breakpoint
CREATE TABLE "security_signal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"security_target_id" uuid NOT NULL,
	"signal_type" text NOT NULL,
	"weight" double precision NOT NULL,
	"reasoning" text NOT NULL,
	"source_event_ids" uuid[] NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_signal_weight_range" CHECK ("security_signal"."weight" >= 0 AND "security_signal"."weight" <= 1)
);
--> statement-breakpoint
CREATE TABLE "security_signal_generation_ledger" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"signals_produced" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_target" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"company_id" uuid,
	"repository_url" text,
	"chain" text,
	"category" "company_category",
	"status" "security_target_status" DEFAULT 'active' NOT NULL,
	"discovery_source" text,
	"discovered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_target_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "security_target_intelligence" (
	"security_target_id" uuid PRIMARY KEY NOT NULL,
	"trend" "intelligence_trend" NOT NULL,
	"confidence" double precision NOT NULL,
	"signal_count" integer NOT NULL,
	"last_signal_at" timestamp with time zone,
	"as_of" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_target_intelligence_confidence_range" CHECK ("security_target_intelligence"."confidence" >= 0 AND "security_target_intelligence"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "audit_contest" ADD CONSTRAINT "audit_contest_security_target_id_security_target_id_fk" FOREIGN KEY ("security_target_id") REFERENCES "public"."security_target"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_bounty" ADD CONSTRAINT "bug_bounty_security_target_id_security_target_id_fk" FOREIGN KEY ("security_target_id") REFERENCES "public"."security_target"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_opportunity" ADD CONSTRAINT "security_opportunity_security_target_id_security_target_id_fk" FOREIGN KEY ("security_target_id") REFERENCES "public"."security_target"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_signal" ADD CONSTRAINT "security_signal_security_target_id_security_target_id_fk" FOREIGN KEY ("security_target_id") REFERENCES "public"."security_target"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_signal_generation_ledger" ADD CONSTRAINT "security_signal_generation_ledger_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_target" ADD CONSTRAINT "security_target_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_target_intelligence" ADD CONSTRAINT "security_target_intelligence_security_target_id_security_target_id_fk" FOREIGN KEY ("security_target_id") REFERENCES "public"."security_target"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_opportunity_security_target_id_idx" ON "security_opportunity" USING btree ("security_target_id");--> statement-breakpoint
CREATE INDEX "security_signal_security_target_id_idx" ON "security_signal" USING btree ("security_target_id");--> statement-breakpoint
CREATE INDEX "security_signal_type_idx" ON "security_signal" USING btree ("signal_type");