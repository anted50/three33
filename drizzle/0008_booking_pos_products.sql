--
-- Booking, part 3: products in the barber POS. Additive:
--   - three nullable columns + a check on barber_sale_lines (new in 0007)
--   - one new label on the shop's inventory_reason enum, 'pos_sale', so a
--     POS stock movement says where it came from in inventory_ledger. No
--     existing row, column or value changes, and shop code never lists the
--     labels exhaustively.
-- Undo with drizzle/rollback/0008_booking_pos_products.down.sql — which
-- cannot remove the enum label (Postgres has no DROP VALUE); an unused label
-- is inert. IF NOT EXISTS is what lets this re-apply after such a rollback.
--
ALTER TYPE "public"."inventory_reason" ADD VALUE IF NOT EXISTS 'pos_sale';--> statement-breakpoint
ALTER TABLE "barber_sale_lines" ADD COLUMN "variant_id" uuid;--> statement-breakpoint
ALTER TABLE "barber_sale_lines" ADD COLUMN "sku_snapshot" text;--> statement-breakpoint
ALTER TABLE "barber_sale_lines" ADD COLUMN "inventory_ledger_id" uuid;--> statement-breakpoint
ALTER TABLE "barber_sale_lines" ADD CONSTRAINT "barber_sale_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_sale_lines" ADD CONSTRAINT "barber_sale_lines_inventory_ledger_id_inventory_ledger_id_fk" FOREIGN KEY ("inventory_ledger_id") REFERENCES "public"."inventory_ledger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_sale_lines" ADD CONSTRAINT "barber_sale_lines_kind_check" CHECK ("barber_sale_lines"."variant_id" is null or "barber_sale_lines"."service_id" is null);
