CREATE TYPE "public"."collector_status" AS ENUM('configured', 'active', 'degraded', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."event_category" AS ENUM('source', 'intelligence', 'decision', 'recommendation', 'application', 'user', 'notification');--> statement-breakpoint
CREATE TABLE "collector" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"source_type" text NOT NULL,
	"status" "collector_status" DEFAULT 'configured' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collector_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"category" "event_category" NOT NULL,
	"version" integer NOT NULL,
	"collector_id" uuid,
	"source_label" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"confidence" double precision NOT NULL,
	"metadata" jsonb NOT NULL,
	CONSTRAINT "event_confidence_range" CHECK ("event"."confidence" >= 0 AND "event"."confidence" <= 1),
	CONSTRAINT "event_source_exclusivity" CHECK (("event"."collector_id" IS NOT NULL) <> ("event"."source_label" IS NOT NULL)),
	CONSTRAINT "event_related_entity_pair" CHECK (("event"."related_entity_type" IS NULL) = ("event"."related_entity_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "event_provenance" (
	"event_id" uuid NOT NULL,
	"caused_by_event_id" uuid NOT NULL,
	CONSTRAINT "event_provenance_event_id_caused_by_event_id_pk" PRIMARY KEY("event_id","caused_by_event_id")
);
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_collector_id_collector_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collector"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_provenance" ADD CONSTRAINT "event_provenance_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_provenance" ADD CONSTRAINT "event_provenance_caused_by_event_id_event_id_fk" FOREIGN KEY ("caused_by_event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_type_idx" ON "event" USING btree ("type");--> statement-breakpoint
CREATE INDEX "event_category_idx" ON "event" USING btree ("category");--> statement-breakpoint
CREATE INDEX "event_collector_id_idx" ON "event" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "event_occurred_at_idx" ON "event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "event_related_entity_idx" ON "event" USING btree ("related_entity_type","related_entity_id");--> statement-breakpoint
CREATE INDEX "event_provenance_caused_by_event_id_idx" ON "event_provenance" USING btree ("caused_by_event_id");