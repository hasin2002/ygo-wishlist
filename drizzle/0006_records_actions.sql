CREATE TABLE "records_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"area" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reason" jsonb NOT NULL,
	"references" jsonb NOT NULL,
	"source_fingerprint" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"dismissed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "records_actions" ADD CONSTRAINT "records_actions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "records_actions_owner_dedupe_unique" ON "records_actions" USING btree ("owner_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "records_actions_owner_status_idx" ON "records_actions" USING btree ("owner_id","status");