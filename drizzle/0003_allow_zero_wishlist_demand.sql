ALTER TABLE "card_targets" DROP CONSTRAINT "card_targets_desired_quantity_positive";--> statement-breakpoint
ALTER TABLE "card_targets" ADD CONSTRAINT "card_targets_desired_quantity_nonnegative" CHECK ("card_targets"."desired_quantity" >= 0);
