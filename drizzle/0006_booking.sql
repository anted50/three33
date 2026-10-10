--
-- Booking. Purely additive: creates new types and tables only. No existing
-- table, column, enum or row is altered — the only links into the shop are
-- foreign keys FROM the new tables TO users, orders and payments.
-- Undo with drizzle/rollback/0006_booking.down.sql.
--
-- btree_gist lets one EXCLUDE constraint combine "same barber" (=) with
-- "overlapping time" (&&) — see the two constraints at the end of this file.
-- A trusted extension since Postgres 13, so it needs no superuser.
--
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."appointment_event_kind" AS ENUM('created', 'rescheduled', 'updated', 'flagged', 'cancelled', 'no_show', 'completed');--> statement-breakpoint
CREATE TYPE "public"."appointment_payment_kind" AS ENUM('booking_fee', 'balance');--> statement-breakpoint
CREATE TYPE "public"."appointment_source" AS ENUM('online', 'barber');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('pending', 'booked', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."barber_ledger_kind" AS ENUM('service_share', 'product_commission', 'cash_collected', 'rent_deduction', 'payout', 'settlement', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('qpay', 'cash', 'pos', 'bank_transfer');--> statement-breakpoint
CREATE TYPE "public"."rent_paid_via" AS ENUM('direct', 'payout');--> statement-breakpoint
CREATE TYPE "public"."rent_period" AS ENUM('weekly', 'biweekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."rent_status" AS ENUM('due', 'paid', 'waived');--> statement-breakpoint
CREATE TABLE "appointment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"kind" "appointment_event_kind" NOT NULL,
	"from_starts_at" timestamp with time zone,
	"to_starts_at" timestamp with time zone,
	"actor_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"kind" "appointment_payment_kind" NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" bigint NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"qpay_invoice_id" text,
	"qpay_payment_id" text,
	"invoice_payload" jsonb,
	"raw_callback" jsonb,
	"received_by_user_id" uuid,
	"paid_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_payments_amount_check" CHECK ("appointment_payments"."amount" > 0),
	CONSTRAINT "appointment_payments_qpay_check" CHECK ("appointment_payments"."method" = 'qpay' or "appointment_payments"."qpay_invoice_id" is null),
	CONSTRAINT "appointment_payments_fee_method_check" CHECK ("appointment_payments"."kind" <> 'booking_fee' or "appointment_payments"."method" = 'qpay'),
	CONSTRAINT "appointment_payments_paid_check" CHECK ("appointment_payments"."status" <> 'paid' or "appointment_payments"."paid_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "appointment_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"service_id" uuid,
	"name_snapshot" text NOT NULL,
	"price_snapshot" bigint NOT NULL,
	"duration_minutes_snapshot" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "appointment_services_values_check" CHECK ("appointment_services"."price_snapshot" >= 0 and "appointment_services"."duration_minutes_snapshot" > 0)
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_no" text NOT NULL,
	"location_id" uuid NOT NULL,
	"barber_id" uuid NOT NULL,
	"source" "appointment_source" NOT NULL,
	"status" "appointment_status" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone NOT NULL,
	"buffer_minutes" integer NOT NULL,
	"total" bigint NOT NULL,
	"booking_fee" bigint NOT NULL,
	"expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"confirmation_sent_at" timestamp with time zone,
	"needs_reschedule_at" timestamp with time zone,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_email" text,
	"note" text,
	"access_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_times_check" CHECK ("appointments"."ends_at" > "appointments"."starts_at" and "appointments"."blocked_until" >= "appointments"."ends_at" and "appointments"."buffer_minutes" >= 0),
	CONSTRAINT "appointments_money_check" CHECK ("appointments"."booking_fee" >= 0 and "appointments"."booking_fee" <= "appointments"."total"),
	CONSTRAINT "appointments_confirmed_check" CHECK ("appointments"."status" not in ('booked', 'completed', 'no_show') or "appointments"."confirmed_at" is not null),
	CONSTRAINT "appointments_pending_check" CHECK ("appointments"."status" <> 'pending' or "appointments"."expires_at" is not null),
	CONSTRAINT "appointments_online_check" CHECK ("appointments"."source" <> 'online' or ("appointments"."booking_fee" > 0 and "appointments"."customer_email" is not null)),
	CONSTRAINT "appointments_barber_check" CHECK ("appointments"."source" <> 'barber' or ("appointments"."booking_fee" = 0 and "appointments"."expires_at" is null))
);
--> statement-breakpoint
CREATE TABLE "barber_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"barber_id" uuid NOT NULL,
	"kind" "barber_ledger_kind" NOT NULL,
	"gross_amount" bigint DEFAULT 0 NOT NULL,
	"rate_bps" integer,
	"amount" bigint NOT NULL,
	"appointment_payment_id" uuid,
	"payment_id" uuid,
	"rent_charge_id" uuid,
	"actor_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barber_ledger_rate_check" CHECK ("barber_ledger"."rate_bps" is null or "barber_ledger"."rate_bps" between 0 and 10000),
	CONSTRAINT "barber_ledger_adjustment_check" CHECK ("barber_ledger"."kind" <> 'adjustment' or "barber_ledger"."note" is not null),
	CONSTRAINT "barber_ledger_rent_check" CHECK ("barber_ledger"."kind" <> 'rent_deduction' or "barber_ledger"."rent_charge_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "barber_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"barber_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barber_shifts_range_check" CHECK ("barber_shifts"."ends_at" > "barber_shifts"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "barber_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"barber_id" uuid NOT NULL,
	"service_cut_bps" integer DEFAULT 0 NOT NULL,
	"product_commission_bps" integer DEFAULT 0 NOT NULL,
	"rent_amount" bigint DEFAULT 0 NOT NULL,
	"rent_period" "rent_period",
	"rent_starts_on" date,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barber_terms_bps_check" CHECK ("barber_terms"."service_cut_bps" between 0 and 10000 and "barber_terms"."product_commission_bps" between 0 and 10000),
	CONSTRAINT "barber_terms_rent_check" CHECK ("barber_terms"."rent_amount" = 0 or ("barber_terms"."rent_amount" > 0 and "barber_terms"."rent_period" is not null and "barber_terms"."rent_starts_on" is not null))
);
--> statement-breakpoint
CREATE TABLE "barbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"bio_mn" text,
	"bio_en" text,
	"photo_url" text,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"booking_fee" bigint DEFAULT 0 NOT NULL,
	"user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barbers_buffer_minutes_check" CHECK ("barbers"."buffer_minutes" >= 0),
	CONSTRAINT "barbers_booking_fee_check" CHECK ("barbers"."booking_fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "in_store_sales" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"barber_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_mn" text NOT NULL,
	"name_en" text NOT NULL,
	"address" text NOT NULL,
	"phone" text,
	"map_link" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rent_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"barber_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"due_on" date NOT NULL,
	"status" "rent_status" DEFAULT 'due' NOT NULL,
	"paid_via" "rent_paid_via",
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rent_charges_amount_check" CHECK ("rent_charges"."amount" > 0),
	CONSTRAINT "rent_charges_paid_check" CHECK ("rent_charges"."status" <> 'paid' or "rent_charges"."paid_via" is not null)
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"barber_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_mn" text,
	"description_en" text,
	"description_mn" text,
	"price" bigint NOT NULL,
	"duration_minutes" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_price_check" CHECK ("services"."price" >= 0),
	CONSTRAINT "services_duration_check" CHECK ("services"."duration_minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_payments" ADD CONSTRAINT "appointment_payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_payments" ADD CONSTRAINT "appointment_payments_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_ledger" ADD CONSTRAINT "barber_ledger_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_ledger" ADD CONSTRAINT "barber_ledger_appointment_payment_id_appointment_payments_id_fk" FOREIGN KEY ("appointment_payment_id") REFERENCES "public"."appointment_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_ledger" ADD CONSTRAINT "barber_ledger_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_ledger" ADD CONSTRAINT "barber_ledger_rent_charge_id_rent_charges_id_fk" FOREIGN KEY ("rent_charge_id") REFERENCES "public"."rent_charges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_ledger" ADD CONSTRAINT "barber_ledger_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_shifts" ADD CONSTRAINT "barber_shifts_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_shifts" ADD CONSTRAINT "barber_shifts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_terms" ADD CONSTRAINT "barber_terms_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_terms" ADD CONSTRAINT "barber_terms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barbers" ADD CONSTRAINT "barbers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_store_sales" ADD CONSTRAINT "in_store_sales_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_store_sales" ADD CONSTRAINT "in_store_sales_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_store_sales" ADD CONSTRAINT "in_store_sales_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_charges" ADD CONSTRAINT "rent_charges_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_charges" ADD CONSTRAINT "rent_charges_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_events_appointment_id_idx" ON "appointment_events" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_payments_qpay_payment_id_key" ON "appointment_payments" USING btree ("qpay_payment_id") WHERE qpay_payment_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_payments_fee_once_key" ON "appointment_payments" USING btree ("appointment_id") WHERE kind = 'booking_fee' and status = 'paid';--> statement-breakpoint
CREATE INDEX "appointment_payments_appointment_id_idx" ON "appointment_payments" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "appointment_payments_qpay_invoice_id_idx" ON "appointment_payments" USING btree ("qpay_invoice_id");--> statement-breakpoint
CREATE INDEX "appointment_services_appointment_id_idx" ON "appointment_services" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_booking_no_key" ON "appointments" USING btree ("booking_no");--> statement-breakpoint
CREATE INDEX "appointments_barber_starts_idx" ON "appointments" USING btree ("barber_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_location_starts_idx" ON "appointments" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_pending_expires_idx" ON "appointments" USING btree ("expires_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "appointments_needs_reschedule_idx" ON "appointments" USING btree ("barber_id") WHERE needs_reschedule_at is not null;--> statement-breakpoint
CREATE INDEX "barber_ledger_barber_created_idx" ON "barber_ledger" USING btree ("barber_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "barber_ledger_appointment_payment_kind_key" ON "barber_ledger" USING btree ("appointment_payment_id","kind") WHERE appointment_payment_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "barber_ledger_payment_kind_key" ON "barber_ledger" USING btree ("payment_id","kind") WHERE payment_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "barber_ledger_rent_charge_key" ON "barber_ledger" USING btree ("rent_charge_id") WHERE rent_charge_id is not null;--> statement-breakpoint
CREATE INDEX "barber_shifts_location_starts_idx" ON "barber_shifts" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE INDEX "barber_shifts_barber_starts_idx" ON "barber_shifts" USING btree ("barber_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "barber_terms_barber_effective_key" ON "barber_terms" USING btree ("barber_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "barbers_slug_key" ON "barbers" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "barbers_user_id_key" ON "barbers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "in_store_sales_barber_created_idx" ON "in_store_sales" USING btree ("barber_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_slug_key" ON "locations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "rent_charges_barber_due_key" ON "rent_charges" USING btree ("barber_id","due_on");--> statement-breakpoint
CREATE INDEX "rent_charges_status_due_idx" ON "rent_charges" USING btree ("status","due_on");--> statement-breakpoint
CREATE INDEX "services_barber_location_idx" ON "services" USING btree ("barber_id","location_id");--> statement-breakpoint
CREATE INDEX "services_location_idx" ON "services" USING btree ("location_id");--> statement-breakpoint
--
-- Not expressible in Drizzle's schema, so written by hand. These are the real
-- guards — code checks availability first for a friendly message, but two
-- requests racing for the same time can only be stopped here.
--
-- A barber can't be on two shifts at once, at any location.
--
ALTER TABLE "barber_shifts" ADD CONSTRAINT "barber_shifts_no_overlap"
  EXCLUDE USING gist ("barber_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&);--> statement-breakpoint
--
-- A barber can't have two appointments overlapping, buffer included. Pending
-- holds count (nobody can take a slot someone is paying for); cancelled ones
-- don't. Unpaid holds are deleted rather than kept, so they need no exemption.
--
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist ("barber_id" WITH =, tstzrange("starts_at", "blocked_until") WITH &&)
  WHERE ("status" <> 'cancelled');
