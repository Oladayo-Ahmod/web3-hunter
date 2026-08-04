CREATE TYPE "public"."intelligence_trend" AS ENUM('insufficient-data', 'increasing', 'stable', 'decreasing');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('detected', 'scored');--> statement-breakpoint
CREATE TABLE "company_intelligence" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"trend" "intelligence_trend" NOT NULL,
	"confidence" double precision NOT NULL,
	"signal_count" integer NOT NULL,
	"last_signal_at" timestamp with time zone,
	"as_of" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_intelligence_confidence_range" CHECK ("company_intelligence"."confidence" >= 0 AND "company_intelligence"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "opportunity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"opportunity_type" text NOT NULL,
	"detection_window" text NOT NULL,
	"status" "opportunity_status" DEFAULT 'detected' NOT NULL,
	"score" double precision,
	"reasoning" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"scored_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_company_type_window_key" UNIQUE("company_id","opportunity_type","detection_window"),
	CONSTRAINT "opportunity_score_range" CHECK ("opportunity"."score" IS NULL OR ("opportunity"."score" >= 0 AND "opportunity"."score" <= 1))
);
--> statement-breakpoint
CREATE TABLE "signal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"signal_type" text NOT NULL,
	"weight" double precision NOT NULL,
	"reasoning" text NOT NULL,
	"source_event_ids" uuid[] NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_weight_range" CHECK ("signal"."weight" >= 0 AND "signal"."weight" <= 1)
);
--> statement-breakpoint
CREATE TABLE "signal_generation_ledger" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"signals_produced" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_intelligence" ADD CONSTRAINT "company_intelligence_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal" ADD CONSTRAINT "signal_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_generation_ledger" ADD CONSTRAINT "signal_generation_ledger_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunity_company_id_idx" ON "opportunity" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "signal_company_id_idx" ON "signal" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "signal_type_idx" ON "signal" USING btree ("signal_type");