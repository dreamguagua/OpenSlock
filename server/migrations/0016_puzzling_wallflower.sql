CREATE TABLE IF NOT EXISTS "agent_login" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_handle" text NOT NULL,
	"integration" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_agent_login" UNIQUE("agent_handle","integration")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_login" ADD CONSTRAINT "agent_login_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
