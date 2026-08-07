CREATE TYPE "public"."company_category" AS ENUM('l1', 'l2', 'defi', 'wallet', 'security', 'infrastructure', 'ai', 'gaming', 'other');--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "careers_page_url" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "documentation_url" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "blog_url" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "twitter_url" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "discord_url" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "headquarters" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "funding_stage" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "category" "company_category";--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "tags" text[];