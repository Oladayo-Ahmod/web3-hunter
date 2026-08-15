ALTER TABLE "company" ADD COLUMN "recently_funded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "funding_date" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "funding_amount" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "funding_source" text;