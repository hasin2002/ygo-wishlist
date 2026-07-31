ALTER TABLE "sealed_units" ADD COLUMN "allocation_index" integer;--> statement-breakpoint
ALTER TABLE "sealed_units" ADD COLUMN "allocation_pence" integer;--> statement-breakpoint
ALTER TABLE "sealed_units" ADD COLUMN "allocation_mode" text DEFAULT 'equal' NOT NULL;--> statement-breakpoint
ALTER TABLE "sealed_units" ADD CONSTRAINT "sealed_units_allocation_index_nonnegative" CHECK ("sealed_units"."allocation_index" is null or "sealed_units"."allocation_index" >= 0);--> statement-breakpoint
ALTER TABLE "sealed_units" ADD CONSTRAINT "sealed_units_allocation_nonnegative" CHECK ("sealed_units"."allocation_pence" is null or "sealed_units"."allocation_pence" >= 0);--> statement-breakpoint
CREATE UNIQUE INDEX "sealed_units_owner_line_allocation_unique" ON "sealed_units" USING btree ("owner_id","acquired_line_id","allocation_index");
