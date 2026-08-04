CREATE TABLE "ebay_listing_families" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"target_id" text NOT NULL,
	"printing_id" text NOT NULL,
	"edition" text NOT NULL,
	"condition" text NOT NULL,
	"selected_copy_ids" jsonb NOT NULL,
	"wishlist_override" boolean DEFAULT false NOT NULL,
	"plan_fingerprint" text NOT NULL,
	"draft" jsonb NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "ebay_listing_families_selected_nonempty" CHECK (jsonb_array_length("ebay_listing_families"."selected_copy_ids") >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_families_owner_id_unique" ON "ebay_listing_families" USING btree ("owner_id","id");
--> statement-breakpoint
CREATE TABLE "ebay_listing_family_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"family_id" text NOT NULL,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"desired_quantity" integer NOT NULL,
	"listing_id" text,
	"publication_uuid" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"state" text DEFAULT 'prepared' NOT NULL,
	"review" jsonb,
	"details" jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "ebay_listing_family_offers_quantity_nonnegative" CHECK ("ebay_listing_family_offers"."desired_quantity" >= 0)
);
--> statement-breakpoint
DROP INDEX "ebay_listings_owner_copy_open_unique";--> statement-breakpoint
ALTER TABLE "ebay_listing_families" ADD CONSTRAINT "ebay_listing_families_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listing_families" ADD CONSTRAINT "ebay_listing_families_target_id_card_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."card_targets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listing_families" ADD CONSTRAINT "ebay_listing_families_printing_id_card_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."card_printings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listing_family_offers" ADD CONSTRAINT "ebay_listing_family_offers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listing_family_offers" ADD CONSTRAINT "ebay_listing_family_offers_family_id_ebay_listing_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."ebay_listing_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listing_family_offers" ADD CONSTRAINT "ebay_listing_family_offers_listing_id_ebay_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."ebay_listings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listing_family_offers" ADD CONSTRAINT "ebay_listing_family_offers_owner_family_fk" FOREIGN KEY ("owner_id","family_id") REFERENCES "public"."ebay_listing_families"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_families_owner_variant_unique" ON "ebay_listing_families" USING btree ("owner_id","printing_id","edition","condition");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_family_offers_owner_family_kind_unique" ON "ebay_listing_family_offers" USING btree ("owner_id","family_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_family_offers_owner_uuid_unique" ON "ebay_listing_family_offers" USING btree ("owner_id","publication_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_family_offers_listing_unique" ON "ebay_listing_family_offers" USING btree ("listing_id") WHERE "ebay_listing_family_offers"."listing_id" is not null;
