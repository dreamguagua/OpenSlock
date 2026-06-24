CREATE TABLE IF NOT EXISTS "membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_membership_account_ws" UNIQUE("account_id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "app_user" DROP CONSTRAINT "app_user_account_id_account_id_fk";
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership" ADD CONSTRAINT "membership_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "membership" ADD CONSTRAINT "membership_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_membership_account" ON "membership" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_membership_ws_handle" ON "membership" USING btree ("workspace_id","handle");--> statement-breakpoint
-- 回填:把 0018 写到 app_user 的 account_id/role 搬进 membership(权威表),再删除冗余列。
INSERT INTO "membership" ("account_id", "workspace_id", "handle", "role")
  SELECT "account_id", "workspace_id", "handle", "role"
  FROM "app_user"
  WHERE "account_id" IS NOT NULL
  ON CONFLICT ("account_id", "workspace_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "app_user" DROP COLUMN IF EXISTS "account_id";--> statement-breakpoint
ALTER TABLE "app_user" DROP COLUMN IF EXISTS "role";