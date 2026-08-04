ALTER TABLE "sealed_units" ADD COLUMN IF NOT EXISTS "allocation_index" integer;--> statement-breakpoint
ALTER TABLE "sealed_units" ADD COLUMN IF NOT EXISTS "allocation_pence" integer;--> statement-breakpoint
ALTER TABLE "sealed_units" ADD COLUMN IF NOT EXISTS "allocation_mode" text DEFAULT 'equal' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sealed_units_allocation_index_nonnegative'
      AND conrelid = 'public.sealed_units'::regclass
  ) THEN
    ALTER TABLE "sealed_units"
      ADD CONSTRAINT "sealed_units_allocation_index_nonnegative"
      CHECK ("sealed_units"."allocation_index" is null or "sealed_units"."allocation_index" >= 0);
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sealed_units_allocation_nonnegative'
      AND conrelid = 'public.sealed_units'::regclass
  ) THEN
    ALTER TABLE "sealed_units"
      ADD CONSTRAINT "sealed_units_allocation_nonnegative"
      CHECK ("sealed_units"."allocation_pence" is null or "sealed_units"."allocation_pence" >= 0);
  END IF;
END
$$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sealed_units_owner_line_allocation_unique" ON "sealed_units" USING btree ("owner_id","acquired_line_id","allocation_index");
