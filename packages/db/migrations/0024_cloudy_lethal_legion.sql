CREATE TABLE "security_target_source_identity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collector_id" uuid NOT NULL,
	"source_identifier" text NOT NULL,
	"security_target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_target_source_identity_collector_id_source_identifier_key" UNIQUE("collector_id","source_identifier")
);
--> statement-breakpoint
ALTER TABLE "security_target_source_identity" ADD CONSTRAINT "security_target_source_identity_collector_id_collector_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collector"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_target_source_identity" ADD CONSTRAINT "security_target_source_identity_security_target_id_security_target_id_fk" FOREIGN KEY ("security_target_id") REFERENCES "public"."security_target"("id") ON DELETE no action ON UPDATE no action;