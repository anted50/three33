--
-- Undoes drizzle/0006_booking.sql, returning the database to exactly its
-- 0005 state. Drizzle has no down migrations, so this is run by hand:
--
--   psql "$DATABASE_URL" -f drizzle/rollback/0006_booking.down.sql
--
-- then revert the commit that added 0006 (schema.ts, the migration, its
-- snapshot and journal entry) so the app stops expecting these tables.
--
-- DESTROYS ALL BOOKING DATA: appointments, barbers, services, shifts, terms,
-- rent and the barber ledger. Nothing in the shop tables is touched — no
-- shop table, column or row was changed by 0006. Back up first if any of it
-- matters.
--
-- No CASCADE anywhere: every table is dropped by name, children first, so if
-- something unexpected has come to depend on one of them this fails loudly
-- instead of quietly taking it along. One transaction: all or nothing.
--
BEGIN;

DROP TABLE "barber_ledger";
DROP TABLE "in_store_sales";
DROP TABLE "appointment_payments";
DROP TABLE "appointment_events";
DROP TABLE "appointment_services";
DROP TABLE "appointments";
DROP TABLE "rent_charges";
DROP TABLE "barber_terms";
DROP TABLE "barber_shifts";
DROP TABLE "services";
DROP TABLE "barbers";
DROP TABLE "locations";

DROP TYPE "public"."appointment_event_kind";
DROP TYPE "public"."appointment_payment_kind";
DROP TYPE "public"."appointment_source";
DROP TYPE "public"."appointment_status";
DROP TYPE "public"."barber_ledger_kind";
DROP TYPE "public"."payment_method";
DROP TYPE "public"."rent_paid_via";
DROP TYPE "public"."rent_period";
DROP TYPE "public"."rent_status";

-- Only 0006 uses it; this fails (and rolls everything back) if anything else
-- has started to.
DROP EXTENSION IF EXISTS btree_gist;

-- Forget that 0006 ran, so `npm run db:migrate` would apply it again. The
-- value is 0006's "when" in drizzle/meta/_journal.json.
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1790495299633;

COMMIT;
