CREATE TABLE "checkout_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" text,
	"phone" text NOT NULL,
	"cart_id" uuid,
	"order_id" uuid,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cart_id" uuid;--> statement-breakpoint
--
-- expires_at and access_token_hash are NOT NULL, so they are added nullable,
-- backfilled, then constrained. Adding them NOT NULL outright fails on any
-- table that already has rows.
--
ALTER TABLE "orders" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "access_token_hash" text;--> statement-breakpoint
--
-- Existing orders predate the invoice window; give them one that has already
-- passed so the sweep treats them as it would any lapsed checkout.
--
UPDATE "orders" SET "expires_at" = "created_at" + interval '2 hours' WHERE "expires_at" IS NULL;--> statement-breakpoint
--
-- A random hash no token can match: legacy customer-facing order links stop
-- working, deliberately. Those orders were reachable by anyone who guessed the
-- order number, which is the hole this column closes; admin still sees them all.
--
UPDATE "orders" SET "access_token_hash" = encode(sha256((("id"::text) || random()::text)::bytea), 'hex') WHERE "access_token_hash" IS NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "access_token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_attempts_ip_created_at_idx" ON "checkout_attempts" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "checkout_attempts_phone_created_at_idx" ON "checkout_attempts" USING btree ("phone","created_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_cart_id_idx" ON "orders" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "orders_pending_expires_idx" ON "orders" USING btree ("expires_at") WHERE status = 'pending_payment';