--
-- Undoes drizzle/0007_booking_pos.sql, returning the database to its 0006
-- state. Run by hand, then revert the commit that added 0007:
--
--   psql "$DATABASE_URL" -f drizzle/rollback/0007_booking_pos.down.sql
--
-- DESTROYS all POS sales and their payments, barber location assignments
-- and days off. Ledger rows that point at a sale payment block this (FK
-- restrict) — delete or keep them deliberately first. Rolling back 0006 as
-- well means running 0006_booking.down.sql after this one.
--
BEGIN;

DROP INDEX "barber_ledger_sale_payment_kind_key";
ALTER TABLE "barber_ledger" DROP CONSTRAINT "barber_ledger_sale_payment_id_barber_sale_payments_id_fk";
ALTER TABLE "barber_ledger" DROP COLUMN "sale_payment_id";

DROP TABLE "barber_sale_payments";
DROP TABLE "barber_sale_lines";
DROP TABLE "barber_sales";
DROP TABLE "barber_days_off";
DROP TABLE "barber_locations";

DROP TYPE "public"."barber_sale_status";

DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790499189711;

COMMIT;
