CREATE TABLE "ebay_listing_publication_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"plan_fingerprint" text NOT NULL,
	"plan" jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "ebay_listing_publication_groups_plan_nonempty" CHECK (jsonb_array_length("ebay_listing_publication_groups"."plan") >= 2)
);
--> statement-breakpoint
CREATE TABLE "ebay_listing_publications" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"offer_id" text NOT NULL,
	"publication_uuid" text NOT NULL,
	"plan_fingerprint" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"listing_id" text NOT NULL,
	"kind" text NOT NULL,
	"copy_ids" jsonb NOT NULL,
	"state" text DEFAULT 'prepared' NOT NULL,
	"item_id" text,
	"last_error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "ebay_listing_publications_uuid_format" CHECK ("ebay_listing_publications"."publication_uuid" ~ '^[A-F0-9]{32}$'),
	CONSTRAINT "ebay_listing_publications_copy_ids_nonempty" CHECK (jsonb_array_length("ebay_listing_publications"."copy_ids") >= 1)
);
--> statement-breakpoint
DROP INDEX "ebay_listings_owner_copy_open_unique";--> statement-breakpoint
ALTER TABLE "ebay_listing_publication_groups" ADD CONSTRAINT "ebay_listing_publication_groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listing_publications" ADD CONSTRAINT "ebay_listing_publications_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listing_publications" ADD CONSTRAINT "ebay_listing_publications_owner_group_fk" FOREIGN KEY ("owner_id","batch_id") REFERENCES "public"."ebay_listing_publication_groups"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_publication_groups_owner_id_unique" ON "ebay_listing_publication_groups" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_publications_owner_id_unique" ON "ebay_listing_publications" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_publications_owner_batch_offer_unique" ON "ebay_listing_publications" USING btree ("owner_id","batch_id","offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_publications_owner_uuid_unique" ON "ebay_listing_publications" USING btree ("owner_id","publication_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_publications_listing_id_unique" ON "ebay_listing_publications" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_publications_item_id_unique" ON "ebay_listing_publications" USING btree ("item_id") WHERE "ebay_listing_publications"."item_id" is not null;--> statement-breakpoint
CREATE INDEX "ebay_listing_publications_owner_state_idx" ON "ebay_listing_publications" USING btree ("owner_id","state");