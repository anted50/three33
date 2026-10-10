--
-- Undoes drizzle/0008_booking_pos_products.sql, back to the 0007 schema.
-- Run by hand, then revert the commit that added 0008:
--
--   psql "$DATABASE_URL" -f drizzle/rollback/0008_booking_pos_products.down.sql
--
-- Product lines lose their variant link, sku and stock-movement link; the
-- inventory_ledger rows they caused stay (stock really moved).
--
-- The 'pos_sale' label on inventory_reason STAYS: Postgres cannot drop an
-- enum value, and rebuilding a shop type to remove an unused label would be
-- riskier than leaving it. Nothing writes it once 0008's code is reverted.
--
BEGIN;

ALTER TABLE "barber_sale_lines" DROP CONSTRAINT "barber_sale_lines_kind_check";
ALTER TABLE "barber_sale_lines" DROP CONSTRAINT "barber_sale_lines_inventory_ledger_id_inventory_ledger_id_fk";
ALTER TABLE "barber_sale_lines" DROP CONSTRAINT "barber_sale_lines_variant_id_product_variants_id_fk";
ALTER TABLE "barber_sale_lines" DROP COLUMN "inventory_ledger_id";
ALTER TABLE "barber_sale_lines" DROP COLUMN "sku_snapshot";
ALTER TABLE "barber_sale_lines" DROP COLUMN "variant_id";

DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790500508736;

COMMIT;
