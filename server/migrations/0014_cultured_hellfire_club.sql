CREATE TYPE "public"."action_status" AS ENUM('pending', 'executed', 'dismissed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "action_status" DEFAULT 'pending' NOT NULL,
	"channel_id" uuid,
	"prepared_by_type" "actor_type" NOT NULL,
	"prepared_by_id" text NOT NULL,
	"executed_by_type" "actor_type",
	"executed_by_id" text,
	"result_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "action_card" ADD CONSTRAINT "action_card_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "action_card" ADD CONSTRAINT "action_card_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_action_card_status" ON "action_card" USING btree ("workspace_id","status");