CREATE TABLE "job_eligibility" (
	"company_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"state_event_id" uuid NOT NULL,
	"gate_fingerprint" text NOT NULL,
	"eligible" boolean NOT NULL,
	"reason_code" text NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_eligibility_company_id_external_id_pk" PRIMARY KEY("company_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "job_eligibility" ADD CONSTRAINT "job_eligibility_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_eligibility" ADD CONSTRAINT "job_eligibility_state_event_id_event_id_fk" FOREIGN KEY ("state_event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;