CREATE TABLE "card_catalogue_products" (
	"product_id" integer PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"name" text NOT NULL,
	"image_url" text,
	"tcgplayer_url" text NOT NULL,
	"set_code" text NOT NULL,
	"set_name" text NOT NULL,
	"rarity" text NOT NULL,
	"search_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_catalogue_staging" (
	"group_id" integer PRIMARY KEY NOT NULL,
	"source_timestamp" text NOT NULL,
	"products" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_catalogue_sync" (
	"id" text PRIMARY KEY NOT NULL,
	"source_timestamp" text,
	"pending_timestamp" text,
	"pending_groups" jsonb,
	"last_attempt_at" timestamp,
	"updated_at" timestamp,
	"product_count" integer DEFAULT 0 NOT NULL,
	"syncing" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "card_catalogue_search_idx" ON "card_catalogue_products" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint
CREATE INDEX "card_catalogue_set_code_idx" ON "card_catalogue_products" USING btree ("set_code");--> statement-breakpoint
CREATE INDEX "card_catalogue_rarity_idx" ON "card_catalogue_products" USING btree ("rarity");