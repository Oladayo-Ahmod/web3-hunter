CREATE TYPE "public"."pipeline_run_status" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "pipeline_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pipeline_name" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"status" "pipeline_run_status" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"metrics" jsonb,
	"error_message" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pipeline_run_pipeline_name_idx" ON "pipeline_run" USING btree ("pipeline_name");--> statement-breakpoint
CREATE INDEX "pipeline_run_scope_idx" ON "pipeline_run" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "pipeline_run_recorded_at_idx" ON "pipeline_run" USING btree ("recorded_at");