CREATE TABLE IF NOT EXISTS "invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_by_handle" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "account" DROP CONSTRAINT "account_workspace_id_workspace_id_fk";
--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "handle" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "created_by_handle" text;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "created_by_account_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invite" ADD CONSTRAINT "invite_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invite_token" ON "invite" USING btree ("token");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_user" ADD CONSTRAINT "app_user_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace" ADD CONSTRAINT "workspace_created_by_account_id_account_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- 回填:老模型每个 account 绑定一个工作区+handle。把对应 app_user 关联到该 account,
-- 并将其角色设为 owner(老数据里建工作区的人即 owner);其余成员保持默认 member。
UPDATE "app_user" au
  SET "account_id" = a."id", "role" = 'owner'
  FROM "account" a
  WHERE a."workspace_id" = au."workspace_id" AND a."handle" = au."handle";
--> statement-breakpoint
-- 回填:工作区创建者 = 绑定该工作区的那个 account。
UPDATE "workspace" w
  SET "created_by_account_id" = a."id"
  FROM "account" a
  WHERE a."workspace_id" = w."id" AND w."created_by_account_id" IS NULL;
--> statement-breakpoint
-- 回填:account.name 缺省取其 handle。
UPDATE "account" SET "name" = "handle" WHERE "name" IS NULL AND "handle" IS NOT NULL;
