ALTER TABLE "account" ADD COLUMN "issuer" text NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;