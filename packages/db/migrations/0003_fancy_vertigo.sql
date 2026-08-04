CREATE TABLE "company" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "raw_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collector_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_record_collector_content_hash_key" UNIQUE("collector_id","content_hash")
);
--> statement-breakpoint
CREATE TABLE "raw_record_ingestion" (
	"raw_record_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "raw_record" ADD CONSTRAINT "raw_record_collector_id_collector_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collector"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_record_ingestion" ADD CONSTRAINT "raw_record_ingestion_raw_record_id_raw_record_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "public"."raw_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_record_ingestion" ADD CONSTRAINT "raw_record_ingestion_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raw_record_collector_id_idx" ON "raw_record" USING btree ("collector_id");