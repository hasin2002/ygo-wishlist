ALTER TABLE "card_targets" DROP CONSTRAINT IF EXISTS "card_targets_desired_quantity_positive";--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'card_targets_desired_quantity_nonnegative'
      AND conrelid = 'public.card_targets'::regclass
  ) THEN
    ALTER TABLE "card_targets"
      ADD CONSTRAINT "card_targets_desired_quantity_nonnegative"
      CHECK ("card_targets"."desired_quantity" >= 0);
  END IF;
END
$$;
