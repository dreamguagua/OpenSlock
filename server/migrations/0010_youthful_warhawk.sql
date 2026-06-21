ALTER TABLE "message" ADD COLUMN "search_tokens" text[];
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_message_search_tokens" ON "message" USING gin ("search_tokens");
