CREATE TYPE "public"."reminder_event_kind" AS ENUM('scheduled', 'fired', 'snoozed', 'updated', 'cancelled', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."reminder_kind" AS ENUM('once', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('scheduled', 'snoozed', 'cancelled', 'done');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_type" "actor_type" NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"anchor_channel_id" uuid,
	"anchor_message_id" uuid,
	"kind" "reminder_kind" NOT NULL,
	"fire_at" timestamp with time zone,
	"cron" text,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"next_fire_at" timestamp with time zone,
	"status" "reminder_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminder_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"reminder_id" uuid NOT NULL,
	"kind" "reminder_event_kind" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
ALTER TABLE "channel" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "channel" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "channel" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channel" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel_member" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "created_by_type" "actor_type";--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "created_by_id" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminder" ADD CONSTRAINT "reminder_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminder" ADD CONSTRAINT "reminder_anchor_channel_id_channel_id_fk" FOREIGN KEY ("anchor_channel_id") REFERENCES "public"."channel"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminder_event" ADD CONSTRAINT "reminder_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminder_event" ADD CONSTRAINT "reminder_event_reminder_id_reminder_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminder"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reminder_owner" ON "reminder" USING btree ("workspace_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reminder_due" ON "reminder" USING btree ("next_fire_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reminder_event_reminder" ON "reminder_event" USING btree ("reminder_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_board" ON "task" USING btree ("workspace_id","channel_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_task_assignee" ON "task" USING btree ("workspace_id","assignee_type","assignee_id");