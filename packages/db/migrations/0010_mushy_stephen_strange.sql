CREATE TYPE "public"."recommendation_status" AS ENUM('active', 'dismissed', 'archived', 'expired');--> statement-breakpoint
CREATE TABLE "recommendation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"match_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"status" "recommendation_status" DEFAULT 'active' NOT NULL,
	"priority" double precision NOT NULL,
	"reason_code" text NOT NULL,
	"reason_details" jsonb NOT NULL,
	"reason_version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_match_id_key" UNIQUE("match_id"),
	CONSTRAINT "recommendation_priority_range" CHECK ("recommendation"."priority" >= 0 AND "recommendation"."priority" <= 1)
);
--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_match_id_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."match"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recommendation_user_id_status_idx" ON "recommendation" USING btree ("user_id","status");