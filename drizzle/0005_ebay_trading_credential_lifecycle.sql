ALTER TABLE "ebay_connections" ADD COLUMN "deployment_slot" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ebay_connections" ADD COLUMN "ebay_user_id" text;--> statement-breakpoint
ALTER TABLE "ebay_connections" ADD COLUMN "trading_auth_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "ebay_connections" ADD COLUMN "trading_auth_token_iv" text;--> statement-breakpoint
ALTER TABLE "ebay_connections" ADD COLUMN "trading_auth_token_tag" text;--> statement-breakpoint
ALTER TABLE "ebay_connections" ADD COLUMN "trading_auth_token_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "ebay_connections" ADD COLUMN "trading_auth_token_status" text DEFAULT 'missing' NOT NULL;--> statement-breakpoint
ALTER TABLE "ebay_connections" ADD COLUMN "trading_auth_token_checked_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "ebay_connections_single_deployment_unique" ON "ebay_connections" USING btree ("deployment_slot");--> statement-breakpoint
ALTER TABLE "ebay_connections" ADD CONSTRAINT "ebay_connections_deployment_slot_one" CHECK ("ebay_connections"."deployment_slot" = 1);--> statement-breakpoint
ALTER TABLE "ebay_connections" ADD CONSTRAINT "ebay_connections_trading_token_complete" CHECK ((
        "ebay_connections"."trading_auth_token_ciphertext" is null
        and "ebay_connections"."trading_auth_token_iv" is null
        and "ebay_connections"."trading_auth_token_tag" is null
        and "ebay_connections"."trading_auth_token_expires_at" is null
      ) or (
        "ebay_connections"."trading_auth_token_ciphertext" is not null
        and "ebay_connections"."trading_auth_token_iv" is not null
        and "ebay_connections"."trading_auth_token_tag" is not null
        and "ebay_connections"."trading_auth_token_expires_at" is not null
        and "ebay_connections"."ebay_user_id" is not null
      ));