CREATE TABLE "card_pricing_estimates" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"printing_id" text NOT NULL,
	"condition" text NOT NULL,
	"estimated_price_pence" integer,
	"ebay_search_url" text NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"used_condition_fallback" boolean DEFAULT false NOT NULL,
	"refreshed_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "card_pricing_estimates_price_nonnegative" CHECK ("card_pricing_estimates"."estimated_price_pence" is null or "card_pricing_estimates"."estimated_price_pence" >= 0),
	CONSTRAINT "card_pricing_estimates_sample_nonnegative" CHECK ("card_pricing_estimates"."sample_size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "card_pricing_estimates" ADD CONSTRAINT "card_pricing_estimates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_pricing_estimates" ADD CONSTRAINT "card_pricing_estimates_printing_id_card_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."card_printings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_pricing_estimates_owner_variant_unique" ON "card_pricing_estimates" USING btree ("owner_id","printing_id","condition");--> statement-breakpoint
CREATE INDEX "card_pricing_estimates_owner_printing_idx" ON "card_pricing_estimates" USING btree ("owner_id","printing_id");