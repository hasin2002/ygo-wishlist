CREATE TABLE "card_listing_photo_images" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"printing_id" text NOT NULL,
	"edition" text NOT NULL,
	"condition" text NOT NULL,
	"kind" text NOT NULL,
	"object_key" text NOT NULL,
	"position" integer NOT NULL,
	"source_copy_id" text,
	"source_inventory_key" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "card_listing_photo_images_position_nonnegative" CHECK ("card_listing_photo_images"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "card_listing_photo_images" ADD CONSTRAINT "card_listing_photo_images_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_listing_photo_images" ADD CONSTRAINT "card_listing_photo_images_printing_id_card_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."card_printings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_listing_photo_images_object_key_unique" ON "card_listing_photo_images" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "card_listing_photo_images_variant_position_unique" ON "card_listing_photo_images" USING btree ("owner_id","printing_id","edition","condition","kind","position");--> statement-breakpoint
CREATE INDEX "card_listing_photo_images_variant_idx" ON "card_listing_photo_images" USING btree ("owner_id","printing_id","edition","condition","kind");