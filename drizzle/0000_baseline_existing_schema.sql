CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "binder_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text,
	"page_index" integer NOT NULL,
	"slot_index" integer NOT NULL,
	"card_id" integer NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bulk_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"acquired_record_id" text NOT NULL,
	"acquired_line_id" text NOT NULL,
	"name" text NOT NULL,
	"total_quantity" integer NOT NULL,
	"itemized_quantity" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "bulk_lots_total_positive" CHECK ("bulk_lots"."total_quantity" >= 1),
	CONSTRAINT "bulk_lots_itemized_nonnegative" CHECK ("bulk_lots"."itemized_quantity" >= 0),
	CONSTRAINT "bulk_lots_itemized_within_total" CHECK ("bulk_lots"."itemized_quantity" <= "bulk_lots"."total_quantity")
);
--> statement-breakpoint
CREATE TABLE "card_copies" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"printing_id" text NOT NULL,
	"acquired_record_id" text NOT NULL,
	"acquired_line_id" text NOT NULL,
	"sold_record_id" text,
	"sold_line_id" text,
	"bulk_lot_id" text,
	"allocation_index" integer,
	"allocation_pence" integer,
	"status" text DEFAULT 'available' NOT NULL,
	"condition" text DEFAULT 'Near Mint' NOT NULL,
	"location" text,
	"sticker_number" text,
	"private_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "card_copies_allocation_index_nonnegative" CHECK ("card_copies"."allocation_index" is null or "card_copies"."allocation_index" >= 0),
	CONSTRAINT "card_copies_allocation_nonnegative" CHECK ("card_copies"."allocation_pence" is null or "card_copies"."allocation_pence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "card_copy_images" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"copy_id" text NOT NULL,
	"object_key" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "card_copy_images_position_nonnegative" CHECK ("card_copy_images"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "card_printings" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"target_id" text NOT NULL,
	"set_name" text NOT NULL,
	"normalized_set_name" text NOT NULL,
	"set_code" text NOT NULL,
	"normalized_set_code" text NOT NULL,
	"tcgplayer_url" text,
	"canonical_tcgplayer_url" text,
	"image_url" text,
	"metadata_needs_attention" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"rarity" text NOT NULL,
	"normalized_rarity" text NOT NULL,
	"edition" text NOT NULL,
	"normalized_edition" text NOT NULL,
	"desired_quantity" integer DEFAULT 1 NOT NULL,
	"image_url" text,
	"tcgplayer_url" text,
	"estimated_price_pence" integer,
	"market_price_pence" integer,
	"ebay_search_url" text,
	"ebay_listing_url" text,
	"card_type" text,
	"notes" text DEFAULT '' NOT NULL,
	"chase_level" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "card_targets_desired_quantity_positive" CHECK ("card_targets"."desired_quantity" >= 1),
	CONSTRAINT "card_targets_estimated_price_nonnegative" CHECK ("card_targets"."estimated_price_pence" is null or "card_targets"."estimated_price_pence" >= 0),
	CONSTRAINT "card_targets_market_price_nonnegative" CHECK ("card_targets"."market_price_pence" is null or "card_targets"."market_price_pence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text,
	"name" text NOT NULL,
	"url" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"image_url" text,
	"price_text" text,
	"market_price_text" text,
	"paid_price_text" text,
	"purchase_month" text,
	"ebay_search_url" text,
	"ebay_listing_url" text,
	"rarity" text,
	"card_type" text,
	"chase_level" integer,
	"status" text DEFAULT 'wishlist' NOT NULL,
	"notes" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ebay_connections" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"refresh_token_ciphertext" text NOT NULL,
	"refresh_token_iv" text NOT NULL,
	"refresh_token_tag" text NOT NULL,
	"refresh_token_expires_at" timestamp NOT NULL,
	"scopes" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ebay_listing_members" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"copy_id" text NOT NULL,
	"fulfilment_position" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "ebay_listing_members_position_nonnegative" CHECK ("ebay_listing_members"."fulfilment_position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ebay_listings" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"copy_id" text NOT NULL,
	"kind" text DEFAULT 'individual' NOT NULL,
	"item_id" text NOT NULL,
	"listing_url" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"listing_state" text DEFAULT 'unknown' NOT NULL,
	"sale_state" text DEFAULT 'none' NOT NULL,
	"remote_listing_status" text,
	"remote_order_status" text,
	"quantity_sold" integer,
	"ending_reason" text,
	"listing_started_at" timestamp,
	"listing_ended_at" timestamp,
	"payment_pending_at" timestamp,
	"paid_at" timestamp,
	"cancelled_at" timestamp,
	"order_id" text,
	"order_line_item_id" text,
	"transaction_id" text,
	"sale_record_id" text,
	"last_remote_event_at" timestamp,
	"last_notification_id" text,
	"last_notification_at" timestamp,
	"last_sync_attempt_at" timestamp,
	"last_synced_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"last_error" text,
	"last_error_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "ebay_listings_quantity_sold_nonnegative" CHECK ("ebay_listings"."quantity_sold" is null or "ebay_listings"."quantity_sold" >= 0),
	CONSTRAINT "ebay_listings_retry_count_nonnegative" CHECK ("ebay_listings"."retry_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ebay_notification_events" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"subscription_id" text,
	"listing_id" text,
	"notification_id" text NOT NULL,
	"topic" text NOT NULL,
	"seller_user_id" text,
	"item_id" text,
	"listing_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"order_id" text,
	"order_line_item_id" text,
	"event_at" timestamp,
	"published_at" timestamp,
	"received_at" timestamp NOT NULL,
	"payload_hash" text NOT NULL,
	"processing_status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"next_attempt_at" timestamp,
	"processed_at" timestamp,
	"outcome" text,
	"last_error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "ebay_notification_events_attempt_count_nonnegative" CHECK ("ebay_notification_events"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ebay_notification_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"topic" text NOT NULL,
	"destination_id" text NOT NULL,
	"remote_subscription_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"scope_version" integer DEFAULT 1 NOT NULL,
	"enabled_at" timestamp,
	"disabled_at" timestamp,
	"verified_at" timestamp,
	"expires_at" timestamp,
	"last_checked_at" timestamp,
	"last_notification_at" timestamp,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp,
	"last_error" text,
	"last_error_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "ebay_notification_sub_scope_version_positive" CHECK ("ebay_notification_subscriptions"."scope_version" >= 1),
	CONSTRAINT "ebay_notification_sub_retry_count_nonnegative" CHECK ("ebay_notification_subscriptions"."retry_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ebay_order_line_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"order_line_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"listing_member_id" text NOT NULL,
	"copy_id" text NOT NULL,
	"fulfilment_position" integer NOT NULL,
	"allocated_at" timestamp NOT NULL,
	"released_at" timestamp,
	"release_reason" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "ebay_order_line_allocations_position_nonnegative" CHECK ("ebay_order_line_allocations"."fulfilment_position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ebay_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"order_id" text,
	"order_line_item_id" text,
	"transaction_id" text,
	"quantity_purchased" integer NOT NULL,
	"payment_state" text DEFAULT 'pending' NOT NULL,
	"remote_order_status" text,
	"payment_pending_at" timestamp,
	"paid_at" timestamp,
	"cancelled_at" timestamp,
	"needs_review_at" timestamp,
	"last_remote_event_at" timestamp,
	"sale_record_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "ebay_order_lines_quantity_positive" CHECK ("ebay_order_lines"."quantity_purchased" >= 1)
);
--> statement-breakpoint
CREATE TABLE "feature_idea_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"canvas" jsonb NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legacy_card_target_links" (
	"legacy_card_id" integer PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text,
	"month" text NOT NULL,
	"card_id" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_refresh_states" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"last_refreshed_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"occurred_on" date NOT NULL,
	"title" text NOT NULL,
	"title_generated" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"listing_url" text,
	"amount_pence" integer DEFAULT 0 NOT NULL,
	"amount_known" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "record_entries_amount_nonnegative" CHECK ("record_entries"."amount_pence" >= 0),
	CONSTRAINT "record_entries_revision_positive" CHECK ("record_entries"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "record_line_copies" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"record_id" text NOT NULL,
	"line_id" text NOT NULL,
	"copy_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"record_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"allocation_pence" integer,
	"detail" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "record_lines_quantity_positive" CHECK ("record_lines"."quantity" >= 1),
	CONSTRAINT "record_lines_allocation_nonnegative" CHECK ("record_lines"."allocation_pence" is null or "record_lines"."allocation_pence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sealed_units" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"acquired_record_id" text NOT NULL,
	"acquired_line_id" text NOT NULL,
	"opened_record_id" text,
	"name" text NOT NULL,
	"edition" text,
	"tcgplayer_url" text,
	"canonical_tcgplayer_url" text,
	"image_url" text,
	"status" text DEFAULT 'sealed' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supply_items" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"acquired_record_id" text NOT NULL,
	"acquired_line_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "supply_items_quantity_positive" CHECK ("supply_items"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "target_binder_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"page_index" integer NOT NULL,
	"slot_index" integer NOT NULL,
	"target_id" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "target_monthly_favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"month" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "target_wheel_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"target_id" text NOT NULL,
	"sort_order" integer NOT NULL,
	"selected_at" timestamp,
	"selected_order" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"username" text,
	"display_username" text,
	"role" text DEFAULT 'user' NOT NULL,
	"public_collection" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wheel_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" text,
	"card_id" integer NOT NULL,
	"sort_order" integer NOT NULL,
	"selected_at" timestamp,
	"selected_order" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
-- PostgreSQL requires the unique targets of composite foreign keys before the
-- foreign keys themselves. Drizzle emits ordinary indexes after ALTER TABLE,
-- so retain these private backing indexes ahead of the generated constraints.
CREATE UNIQUE INDEX "record_entries_owner_id_fk_key" ON "record_entries" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_copies_owner_id_fk_key" ON "card_copies" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listings_owner_id_fk_key" ON "ebay_listings" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_members_owner_listing_id_copy_fk_key" ON "ebay_listing_members" USING btree ("owner_id","listing_id","id","copy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_order_lines_owner_id_fk_key" ON "ebay_order_lines" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_order_lines_owner_listing_id_fk_key" ON "ebay_order_lines" USING btree ("owner_id","listing_id","id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_slots" ADD CONSTRAINT "binder_slots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binder_slots" ADD CONSTRAINT "binder_slots_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_lots" ADD CONSTRAINT "bulk_lots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_lots" ADD CONSTRAINT "bulk_lots_acquired_record_id_record_entries_id_fk" FOREIGN KEY ("acquired_record_id") REFERENCES "public"."record_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_lots" ADD CONSTRAINT "bulk_lots_acquired_line_id_record_lines_id_fk" FOREIGN KEY ("acquired_line_id") REFERENCES "public"."record_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_copies" ADD CONSTRAINT "card_copies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_copies" ADD CONSTRAINT "card_copies_printing_id_card_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."card_printings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_copies" ADD CONSTRAINT "card_copies_acquired_record_id_record_entries_id_fk" FOREIGN KEY ("acquired_record_id") REFERENCES "public"."record_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_copies" ADD CONSTRAINT "card_copies_acquired_line_id_record_lines_id_fk" FOREIGN KEY ("acquired_line_id") REFERENCES "public"."record_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_copies" ADD CONSTRAINT "card_copies_sold_record_id_record_entries_id_fk" FOREIGN KEY ("sold_record_id") REFERENCES "public"."record_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_copies" ADD CONSTRAINT "card_copies_sold_line_id_record_lines_id_fk" FOREIGN KEY ("sold_line_id") REFERENCES "public"."record_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_copies" ADD CONSTRAINT "card_copies_bulk_lot_id_bulk_lots_id_fk" FOREIGN KEY ("bulk_lot_id") REFERENCES "public"."bulk_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_copy_images" ADD CONSTRAINT "card_copy_images_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_copy_images" ADD CONSTRAINT "card_copy_images_copy_id_card_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."card_copies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_printings" ADD CONSTRAINT "card_printings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_printings" ADD CONSTRAINT "card_printings_target_id_card_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."card_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_targets" ADD CONSTRAINT "card_targets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_connections" ADD CONSTRAINT "ebay_connections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listing_members" ADD CONSTRAINT "ebay_listing_members_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listing_members" ADD CONSTRAINT "ebay_listing_members_owner_listing_fk" FOREIGN KEY ("owner_id","listing_id") REFERENCES "public"."ebay_listings"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listing_members" ADD CONSTRAINT "ebay_listing_members_owner_copy_fk" FOREIGN KEY ("owner_id","copy_id") REFERENCES "public"."card_copies"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD CONSTRAINT "ebay_listings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD CONSTRAINT "ebay_listings_copy_id_card_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."card_copies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_listings" ADD CONSTRAINT "ebay_listings_owner_sale_record_fk" FOREIGN KEY ("owner_id","sale_record_id") REFERENCES "public"."record_entries"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_notification_events" ADD CONSTRAINT "ebay_notification_events_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_notification_events" ADD CONSTRAINT "ebay_notification_events_subscription_id_ebay_notification_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."ebay_notification_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_notification_events" ADD CONSTRAINT "ebay_notification_events_listing_id_ebay_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."ebay_listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_notification_subscriptions" ADD CONSTRAINT "ebay_notification_subscriptions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_order_line_allocations" ADD CONSTRAINT "ebay_order_line_allocations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_order_line_allocations" ADD CONSTRAINT "ebay_order_line_allocations_owner_line_fk" FOREIGN KEY ("owner_id","order_line_id") REFERENCES "public"."ebay_order_lines"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_order_line_allocations" ADD CONSTRAINT "ebay_order_line_allocations_owner_listing_line_fk" FOREIGN KEY ("owner_id","listing_id","order_line_id") REFERENCES "public"."ebay_order_lines"("owner_id","listing_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_order_line_allocations" ADD CONSTRAINT "ebay_order_line_allocations_owner_copy_fk" FOREIGN KEY ("owner_id","copy_id") REFERENCES "public"."card_copies"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_order_line_allocations" ADD CONSTRAINT "ebay_order_line_allocations_owner_listing_member_copy_fk" FOREIGN KEY ("owner_id","listing_id","listing_member_id","copy_id") REFERENCES "public"."ebay_listing_members"("owner_id","listing_id","id","copy_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_order_lines" ADD CONSTRAINT "ebay_order_lines_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_order_lines" ADD CONSTRAINT "ebay_order_lines_sale_record_id_record_entries_id_fk" FOREIGN KEY ("sale_record_id") REFERENCES "public"."record_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_order_lines" ADD CONSTRAINT "ebay_order_lines_owner_listing_fk" FOREIGN KEY ("owner_id","listing_id") REFERENCES "public"."ebay_listings"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_order_lines" ADD CONSTRAINT "ebay_order_lines_owner_sale_record_fk" FOREIGN KEY ("owner_id","sale_record_id") REFERENCES "public"."record_entries"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_idea_pages" ADD CONSTRAINT "feature_idea_pages_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_card_target_links" ADD CONSTRAINT "legacy_card_target_links_legacy_card_id_cards_id_fk" FOREIGN KEY ("legacy_card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_card_target_links" ADD CONSTRAINT "legacy_card_target_links_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_card_target_links" ADD CONSTRAINT "legacy_card_target_links_target_id_card_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."card_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_favorites" ADD CONSTRAINT "monthly_favorites_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_favorites" ADD CONSTRAINT "monthly_favorites_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_refresh_states" ADD CONSTRAINT "pricing_refresh_states_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_line_copies" ADD CONSTRAINT "record_line_copies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_line_copies" ADD CONSTRAINT "record_line_copies_record_id_record_entries_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."record_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_line_copies" ADD CONSTRAINT "record_line_copies_line_id_record_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."record_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_line_copies" ADD CONSTRAINT "record_line_copies_copy_id_card_copies_id_fk" FOREIGN KEY ("copy_id") REFERENCES "public"."card_copies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_lines" ADD CONSTRAINT "record_lines_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_lines" ADD CONSTRAINT "record_lines_record_id_record_entries_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."record_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_units" ADD CONSTRAINT "sealed_units_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_units" ADD CONSTRAINT "sealed_units_acquired_record_id_record_entries_id_fk" FOREIGN KEY ("acquired_record_id") REFERENCES "public"."record_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_units" ADD CONSTRAINT "sealed_units_acquired_line_id_record_lines_id_fk" FOREIGN KEY ("acquired_line_id") REFERENCES "public"."record_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_units" ADD CONSTRAINT "sealed_units_opened_record_id_record_entries_id_fk" FOREIGN KEY ("opened_record_id") REFERENCES "public"."record_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_items" ADD CONSTRAINT "supply_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_items" ADD CONSTRAINT "supply_items_acquired_record_id_record_entries_id_fk" FOREIGN KEY ("acquired_record_id") REFERENCES "public"."record_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supply_items" ADD CONSTRAINT "supply_items_acquired_line_id_record_lines_id_fk" FOREIGN KEY ("acquired_line_id") REFERENCES "public"."record_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_binder_slots" ADD CONSTRAINT "target_binder_slots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_binder_slots" ADD CONSTRAINT "target_binder_slots_target_id_card_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."card_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_monthly_favorites" ADD CONSTRAINT "target_monthly_favorites_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_monthly_favorites" ADD CONSTRAINT "target_monthly_favorites_target_id_card_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."card_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_wheel_entries" ADD CONSTRAINT "target_wheel_entries_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_wheel_entries" ADD CONSTRAINT "target_wheel_entries_target_id_card_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."card_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheel_entries" ADD CONSTRAINT "wheel_entries_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheel_entries" ADD CONSTRAINT "wheel_entries_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_limits_key_unique" ON "auth_rate_limits" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "binder_slots_owner_page_slot_unique" ON "binder_slots" USING btree ("owner_id","page_index","slot_index");--> statement-breakpoint
CREATE UNIQUE INDEX "binder_slots_owner_card_unique" ON "binder_slots" USING btree ("owner_id","card_id");--> statement-breakpoint
CREATE INDEX "bulk_lots_owner_record_idx" ON "bulk_lots" USING btree ("owner_id","acquired_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bulk_lots_acquired_line_unique" ON "bulk_lots" USING btree ("acquired_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_copies_owner_id_unique" ON "card_copies" USING btree ("owner_id","id");--> statement-breakpoint
CREATE INDEX "card_copies_owner_printing_idx" ON "card_copies" USING btree ("owner_id","printing_id");--> statement-breakpoint
CREATE INDEX "card_copies_owner_status_idx" ON "card_copies" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "card_copies_owner_acquired_record_idx" ON "card_copies" USING btree ("owner_id","acquired_record_id");--> statement-breakpoint
CREATE INDEX "card_copies_owner_sold_record_idx" ON "card_copies" USING btree ("owner_id","sold_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "card_copies_owner_sticker_number_unique" ON "card_copies" USING btree ("owner_id","sticker_number") WHERE "card_copies"."sticker_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "card_copies_bulk_allocation_unique" ON "card_copies" USING btree ("owner_id","bulk_lot_id","allocation_index");--> statement-breakpoint
CREATE UNIQUE INDEX "card_copy_images_object_key_unique" ON "card_copy_images" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "card_copy_images_copy_position_unique" ON "card_copy_images" USING btree ("copy_id","position");--> statement-breakpoint
CREATE INDEX "card_copy_images_owner_copy_idx" ON "card_copy_images" USING btree ("owner_id","copy_id");--> statement-breakpoint
CREATE INDEX "card_printings_owner_target_idx" ON "card_printings" USING btree ("owner_id","target_id");--> statement-breakpoint
CREATE INDEX "card_printings_owner_code_idx" ON "card_printings" USING btree ("owner_id","normalized_set_code");--> statement-breakpoint
CREATE INDEX "card_printings_owner_tcgplayer_idx" ON "card_printings" USING btree ("owner_id","canonical_tcgplayer_url");--> statement-breakpoint
CREATE UNIQUE INDEX "card_targets_owner_identity_unique" ON "card_targets" USING btree ("owner_id","normalized_name","normalized_rarity","normalized_edition");--> statement-breakpoint
CREATE INDEX "card_targets_owner_name_idx" ON "card_targets" USING btree ("owner_id","normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_members_owner_id_unique" ON "ebay_listing_members" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_members_owner_listing_id_unique" ON "ebay_listing_members" USING btree ("owner_id","listing_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_members_owner_listing_copy_unique" ON "ebay_listing_members" USING btree ("owner_id","listing_id","copy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_members_owner_listing_id_copy_unique" ON "ebay_listing_members" USING btree ("owner_id","listing_id","id","copy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_members_listing_copy_unique" ON "ebay_listing_members" USING btree ("listing_id","copy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listing_members_listing_position_unique" ON "ebay_listing_members" USING btree ("listing_id","fulfilment_position");--> statement-breakpoint
CREATE INDEX "ebay_listing_members_owner_copy_idx" ON "ebay_listing_members" USING btree ("owner_id","copy_id");--> statement-breakpoint
CREATE INDEX "ebay_listing_members_owner_listing_idx" ON "ebay_listing_members" USING btree ("owner_id","listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listings_owner_id_unique" ON "ebay_listings" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listings_item_id_unique" ON "ebay_listings" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listings_owner_copy_open_unique" ON "ebay_listings" USING btree ("owner_id","copy_id") WHERE "ebay_listings"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listings_owner_order_line_unique" ON "ebay_listings" USING btree ("owner_id","order_id","order_line_item_id") WHERE "ebay_listings"."order_id" is not null and "ebay_listings"."order_line_item_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_listings_owner_transaction_unique" ON "ebay_listings" USING btree ("owner_id","transaction_id") WHERE "ebay_listings"."transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "ebay_listings_owner_copy_idx" ON "ebay_listings" USING btree ("owner_id","copy_id");--> statement-breakpoint
CREATE INDEX "ebay_listings_owner_status_idx" ON "ebay_listings" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "ebay_listings_owner_lifecycle_idx" ON "ebay_listings" USING btree ("owner_id","listing_state","sale_state");--> statement-breakpoint
CREATE INDEX "ebay_listings_reconcile_due_idx" ON "ebay_listings" USING btree ("listing_state","sale_state","next_retry_at");--> statement-breakpoint
CREATE INDEX "ebay_listings_sale_record_idx" ON "ebay_listings" USING btree ("owner_id","sale_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_notification_events_notification_id_unique" ON "ebay_notification_events" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "ebay_notification_events_owner_status_retry_idx" ON "ebay_notification_events" USING btree ("owner_id","processing_status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "ebay_notification_events_owner_item_idx" ON "ebay_notification_events" USING btree ("owner_id","item_id");--> statement-breakpoint
CREATE INDEX "ebay_notification_events_owner_order_idx" ON "ebay_notification_events" USING btree ("owner_id","order_id");--> statement-breakpoint
CREATE INDEX "ebay_notification_events_seller_user_idx" ON "ebay_notification_events" USING btree ("seller_user_id");--> statement-breakpoint
CREATE INDEX "ebay_notification_events_listing_idx" ON "ebay_notification_events" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_notification_sub_remote_id_unique" ON "ebay_notification_subscriptions" USING btree ("remote_subscription_id") WHERE "ebay_notification_subscriptions"."remote_subscription_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_notification_sub_owner_topic_dest_unique" ON "ebay_notification_subscriptions" USING btree ("owner_id","topic","destination_id");--> statement-breakpoint
CREATE INDEX "ebay_notification_sub_owner_status_idx" ON "ebay_notification_subscriptions" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "ebay_notification_sub_retry_idx" ON "ebay_notification_subscriptions" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_order_line_allocations_line_copy_unique" ON "ebay_order_line_allocations" USING btree ("order_line_id","copy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_order_line_allocations_line_position_unique" ON "ebay_order_line_allocations" USING btree ("order_line_id","fulfilment_position");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_order_line_allocations_owner_copy_open_unique" ON "ebay_order_line_allocations" USING btree ("owner_id","copy_id") WHERE "ebay_order_line_allocations"."released_at" is null;--> statement-breakpoint
CREATE INDEX "ebay_order_line_allocations_owner_line_idx" ON "ebay_order_line_allocations" USING btree ("owner_id","order_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_order_lines_owner_id_unique" ON "ebay_order_lines" USING btree ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_order_lines_owner_listing_id_unique" ON "ebay_order_lines" USING btree ("owner_id","listing_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_order_lines_owner_order_line_unique" ON "ebay_order_lines" USING btree ("owner_id","order_id","order_line_item_id") WHERE "ebay_order_lines"."order_id" is not null and "ebay_order_lines"."order_line_item_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_order_lines_owner_transaction_unique" ON "ebay_order_lines" USING btree ("owner_id","transaction_id") WHERE "ebay_order_lines"."transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "ebay_order_lines_owner_listing_idx" ON "ebay_order_lines" USING btree ("owner_id","listing_id");--> statement-breakpoint
CREATE INDEX "ebay_order_lines_owner_sale_record_idx" ON "ebay_order_lines" USING btree ("owner_id","sale_record_id");--> statement-breakpoint
CREATE INDEX "feature_idea_pages_updated_idx" ON "feature_idea_pages" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "legacy_card_target_links_owner_target_idx" ON "legacy_card_target_links" USING btree ("owner_id","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_favorites_owner_month_unique" ON "monthly_favorites" USING btree ("owner_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "record_entries_owner_id_unique" ON "record_entries" USING btree ("owner_id","id");--> statement-breakpoint
CREATE INDEX "record_entries_owner_date_idx" ON "record_entries" USING btree ("owner_id","occurred_on");--> statement-breakpoint
CREATE INDEX "record_entries_owner_type_idx" ON "record_entries" USING btree ("owner_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "record_line_copies_line_copy_unique" ON "record_line_copies" USING btree ("line_id","copy_id");--> statement-breakpoint
CREATE INDEX "record_line_copies_owner_record_idx" ON "record_line_copies" USING btree ("owner_id","record_id");--> statement-breakpoint
CREATE INDEX "record_line_copies_owner_copy_idx" ON "record_line_copies" USING btree ("owner_id","copy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_lines_record_position_unique" ON "record_lines" USING btree ("record_id","position");--> statement-breakpoint
CREATE INDEX "record_lines_owner_record_idx" ON "record_lines" USING btree ("owner_id","record_id");--> statement-breakpoint
CREATE INDEX "sealed_units_owner_status_idx" ON "sealed_units" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "sealed_units_owner_product_idx" ON "sealed_units" USING btree ("owner_id","canonical_tcgplayer_url");--> statement-breakpoint
CREATE INDEX "sealed_units_owner_record_idx" ON "sealed_units" USING btree ("owner_id","acquired_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_unique" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "supply_items_owner_status_idx" ON "supply_items" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "supply_items_owner_record_idx" ON "supply_items" USING btree ("owner_id","acquired_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "target_binder_slots_owner_page_slot_unique" ON "target_binder_slots" USING btree ("owner_id","page_index","slot_index");--> statement-breakpoint
CREATE UNIQUE INDEX "target_binder_slots_owner_target_unique" ON "target_binder_slots" USING btree ("owner_id","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "target_monthly_favorites_owner_month_unique" ON "target_monthly_favorites" USING btree ("owner_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "target_wheel_entries_owner_target_unique" ON "target_wheel_entries" USING btree ("owner_id","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "wheel_entries_owner_card_unique" ON "wheel_entries" USING btree ("owner_id","card_id");
