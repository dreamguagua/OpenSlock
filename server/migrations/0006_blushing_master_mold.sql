ALTER TABLE "agent" ADD COLUMN "provider" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "provider_base_url" text;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "provider_api_key" text;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "reasoning" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "fast_mode" boolean DEFAULT false NOT NULL;