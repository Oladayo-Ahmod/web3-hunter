CREATE TABLE "company_summary" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"version" integer NOT NULL,
	"prompt_version" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"company_id" uuid NOT NULL,
	CONSTRAINT "company_summary_company_id_version_key" UNIQUE("company_id","version"),
	CONSTRAINT "company_summary_version_positive" CHECK ("company_summary"."version" > 0 AND "company_summary"."prompt_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "opportunity_summary" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"version" integer NOT NULL,
	"prompt_version" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	CONSTRAINT "opportunity_summary_opportunity_id_version_key" UNIQUE("opportunity_id","version"),
	CONSTRAINT "opportunity_summary_version_positive" CHECK ("opportunity_summary"."version" > 0 AND "opportunity_summary"."prompt_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "outreach_draft" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"version" integer NOT NULL,
	"prompt_version" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	CONSTRAINT "outreach_draft_recommendation_id_version_key" UNIQUE("recommendation_id","version"),
	CONSTRAINT "outreach_draft_version_positive" CHECK ("outreach_draft"."version" > 0 AND "outreach_draft"."prompt_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "profile_insight" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"version" integer NOT NULL,
	"prompt_version" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "profile_insight_user_id_version_key" UNIQUE("user_id","version"),
	CONSTRAINT "profile_insight_version_positive" CHECK ("profile_insight"."version" > 0 AND "profile_insight"."prompt_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "recommendation_explanation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"version" integer NOT NULL,
	"prompt_version" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	CONSTRAINT "recommendation_explanation_recommendation_id_version_key" UNIQUE("recommendation_id","version"),
	CONSTRAINT "recommendation_explanation_version_positive" CHECK ("recommendation_explanation"."version" > 0 AND "recommendation_explanation"."prompt_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "company_summary" ADD CONSTRAINT "company_summary_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_summary" ADD CONSTRAINT "opportunity_summary_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_draft" ADD CONSTRAINT "outreach_draft_recommendation_id_recommendation_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_insight" ADD CONSTRAINT "profile_insight_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_explanation" ADD CONSTRAINT "recommendation_explanation_recommendation_id_recommendation_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_summary_company_id_idx" ON "company_summary" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "opportunity_summary_opportunity_id_idx" ON "opportunity_summary" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "outreach_draft_recommendation_id_idx" ON "outreach_draft" USING btree ("recommendation_id");--> statement-breakpoint
CREATE INDEX "profile_insight_user_id_idx" ON "profile_insight" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recommendation_explanation_recommendation_id_idx" ON "recommendation_explanation" USING btree ("recommendation_id");