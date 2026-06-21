CREATE TABLE IF NOT EXISTS "thread_unfollow" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_handle" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_thread_unfollow" UNIQUE("agent_handle","thread_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "thread_unfollow" ADD CONSTRAINT "thread_unfollow_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thread_unfollow_thread" ON "thread_unfollow" USING btree ("thread_id");