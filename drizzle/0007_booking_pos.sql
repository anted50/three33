--
-- Booking, part 2: barber locations, days off, and the barber POS (sales,
-- lines, payments). Additive: new types and tables, plus one nullable column
-- on barber_ledger (itself new in 0006). No shop table is touched.
-- Undo with drizzle/rollback/0007_booking_pos.down.sql.
--
CREATE TYPE "public"."barber_sale_status" AS ENUM('open', 'paid', 'void');--> statement-breakpoint
CREATE TABLE "barber_days_off" (
	"barber_id" uuid NOT NULL,
	"day" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barber_days_off_barber_id_day_pk" PRIMARY KEY("barber_id","day")
);
--> statement-breakpoint
CREATE TABLE "barber_locations" (
	"barber_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barber_locations_barber_id_location_id_pk" PRIMARY KEY("barber_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "barber_sale_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"service_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"unit_amount" bigint NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "barber_sale_lines_values_check" CHECK ("barber_sale_lines"."unit_amount" >= 0 and "barber_sale_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "barber_sale_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
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
	CONSTRAINT "barber_sale_payments_amount_check" CHECK ("barber_sale_payments"."amount" > 0),
	CONSTRAINT "barber_sale_payments_qpay_check" CHECK ("barber_sale_payments"."method" = 'qpay' or "barber_sale_payments"."qpay_invoice_id" is null),
	CONSTRAINT "barber_sale_payments_paid_check" CHECK ("barber_sale_payments"."status" <> 'paid' or "barber_sale_payments"."paid_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "barber_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_no" text NOT NULL,
	"barber_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"appointment_id" uuid,
	"status" "barber_sale_status" DEFAULT 'open' NOT NULL,
	"total" bigint NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"customer_name" text,
	"customer_phone" text,
	"customer_email" text,
	"created_by" uuid,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "barber_sales_money_check" CHECK ("barber_sales"."total" >= 0 and "barber_sales"."credit" >= 0 and "barber_sales"."credit" <= "barber_sales"."total"),
	CONSTRAINT "barber_sales_credit_check" CHECK ("barber_sales"."appointment_id" is not null or "barber_sales"."credit" = 0),
	CONSTRAINT "barber_sales_paid_check" CHECK ("barber_sales"."status" <> 'paid' or "barber_sales"."paid_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "barber_ledger" ADD COLUMN "sale_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "barber_days_off" ADD CONSTRAINT "barber_days_off_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_locations" ADD CONSTRAINT "barber_locations_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_locations" ADD CONSTRAINT "barber_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_sale_lines" ADD CONSTRAINT "barber_sale_lines_sale_id_barber_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."barber_sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_sale_lines" ADD CONSTRAINT "barber_sale_lines_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_sale_payments" ADD CONSTRAINT "barber_sale_payments_sale_id_barber_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."barber_sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_sale_payments" ADD CONSTRAINT "barber_sale_payments_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_sales" ADD CONSTRAINT "barber_sales_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_sales" ADD CONSTRAINT "barber_sales_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_sales" ADD CONSTRAINT "barber_sales_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "barber_sales" ADD CONSTRAINT "barber_sales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "barber_locations_location_idx" ON "barber_locations" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "barber_sale_lines_sale_id_idx" ON "barber_sale_lines" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "barber_sale_payments_qpay_payment_id_key" ON "barber_sale_payments" USING btree ("qpay_payment_id") WHERE qpay_payment_id is not null;--> statement-breakpoint
CREATE INDEX "barber_sale_payments_sale_id_idx" ON "barber_sale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "barber_sale_payments_qpay_invoice_id_idx" ON "barber_sale_payments" USING btree ("qpay_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "barber_sales_sale_no_key" ON "barber_sales" USING btree ("sale_no");--> statement-breakpoint
CREATE INDEX "barber_sales_barber_created_idx" ON "barber_sales" USING btree ("barber_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "barber_sales_appointment_key" ON "barber_sales" USING btree ("appointment_id") WHERE appointment_id is not null and status <> 'void';--> statement-breakpoint
ALTER TABLE "barber_ledger" ADD CONSTRAINT "barber_ledger_sale_payment_id_barber_sale_payments_id_fk" FOREIGN KEY ("sale_payment_id") REFERENCES "public"."barber_sale_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "barber_ledger_sale_payment_kind_key" ON "barber_ledger" USING btree ("sale_payment_id","kind") WHERE sale_payment_id is not null;