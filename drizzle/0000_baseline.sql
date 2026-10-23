CREATE TABLE `addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`district` text NOT NULL,
	`khoroo` text NOT NULL,
	`line1` text NOT NULL,
	`line2` text,
	`phone` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `addresses_user_id_idx` ON `addresses` (`user_id`);--> statement-breakpoint
CREATE TABLE `admin_invoices` (
	`order_id` text PRIMARY KEY NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `admin_invoices_created_at_idx` ON `admin_invoices` (`created_at`);--> statement-breakpoint
CREATE TABLE `appointment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`kind` text NOT NULL,
	`from_starts_at` integer,
	`to_starts_at` integer,
	`actor_id` text,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "appointment_events_kind_check" CHECK("appointment_events"."kind" in ('created', 'rescheduled', 'updated', 'flagged', 'cancelled', 'no_show', 'completed'))
);
--> statement-breakpoint
CREATE INDEX `appointment_events_appointment_id_idx` ON `appointment_events` (`appointment_id`);--> statement-breakpoint
CREATE TABLE `appointment_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`kind` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`qpay_invoice_id` text,
	`qpay_payment_id` text,
	`invoice_payload` text,
	`raw_callback` text,
	`received_by_user_id` text,
	`paid_at` integer,
	`last_checked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`received_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "appointment_payments_amount_check" CHECK("appointment_payments"."amount" > 0),
	CONSTRAINT "appointment_payments_qpay_check" CHECK("appointment_payments"."method" = 'qpay' or "appointment_payments"."qpay_invoice_id" is null),
	CONSTRAINT "appointment_payments_fee_method_check" CHECK("appointment_payments"."kind" <> 'booking_fee' or "appointment_payments"."method" = 'qpay'),
	CONSTRAINT "appointment_payments_paid_check" CHECK("appointment_payments"."status" <> 'paid' or "appointment_payments"."paid_at" is not null),
	CONSTRAINT "appointment_payments_status_check" CHECK("appointment_payments"."status" in ('pending', 'paid', 'failed', 'expired', 'refunded')),
	CONSTRAINT "appointment_payments_kind_check" CHECK("appointment_payments"."kind" in ('booking_fee', 'balance')),
	CONSTRAINT "appointment_payments_method_check" CHECK("appointment_payments"."method" in ('qpay', 'cash', 'pos', 'bank_transfer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_payments_qpay_payment_id_key` ON `appointment_payments` (`qpay_payment_id`) WHERE qpay_payment_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_payments_fee_once_key` ON `appointment_payments` (`appointment_id`) WHERE kind = 'booking_fee' and status = 'paid';--> statement-breakpoint
CREATE INDEX `appointment_payments_appointment_id_idx` ON `appointment_payments` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `appointment_payments_qpay_invoice_id_idx` ON `appointment_payments` (`qpay_invoice_id`);--> statement-breakpoint
CREATE TABLE `appointment_services` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`service_id` text,
	`name_snapshot` text NOT NULL,
	`price_snapshot` integer NOT NULL,
	`duration_minutes_snapshot` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "appointment_services_values_check" CHECK("appointment_services"."price_snapshot" >= 0 and "appointment_services"."duration_minutes_snapshot" > 0)
);
--> statement-breakpoint
CREATE INDEX `appointment_services_appointment_id_idx` ON `appointment_services` (`appointment_id`);--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_no` text NOT NULL,
	`location_id` text NOT NULL,
	`barber_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`blocked_until` integer NOT NULL,
	`buffer_minutes` integer NOT NULL,
	`total` integer NOT NULL,
	`booking_fee` integer NOT NULL,
	`expires_at` integer,
	`confirmed_at` integer,
	`confirmed_by` text,
	`confirmation_sent_at` integer,
	`needs_reschedule_at` integer,
	`customer_name` text NOT NULL,
	`customer_phone` text NOT NULL,
	`customer_email` text,
	`note` text,
	`access_token_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "appointments_times_check" CHECK("appointments"."ends_at" > "appointments"."starts_at" and "appointments"."blocked_until" >= "appointments"."ends_at" and "appointments"."buffer_minutes" >= 0),
	CONSTRAINT "appointments_money_check" CHECK("appointments"."booking_fee" >= 0 and "appointments"."booking_fee" <= "appointments"."total"),
	CONSTRAINT "appointments_confirmed_check" CHECK("appointments"."status" not in ('booked', 'completed', 'no_show') or "appointments"."confirmed_at" is not null),
	CONSTRAINT "appointments_pending_check" CHECK("appointments"."status" <> 'pending' or "appointments"."expires_at" is not null),
	CONSTRAINT "appointments_online_check" CHECK("appointments"."source" <> 'online' or ("appointments"."booking_fee" > 0 and "appointments"."customer_email" is not null)),
	CONSTRAINT "appointments_barber_check" CHECK("appointments"."source" <> 'barber' or ("appointments"."booking_fee" = 0 and "appointments"."expires_at" is null)),
	CONSTRAINT "appointments_source_check" CHECK("appointments"."source" in ('online', 'barber')),
	CONSTRAINT "appointments_status_check" CHECK("appointments"."status" in ('pending', 'booked', 'completed', 'cancelled', 'no_show'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_booking_no_key` ON `appointments` (`booking_no`);--> statement-breakpoint
CREATE INDEX `appointments_barber_starts_idx` ON `appointments` (`barber_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_location_starts_idx` ON `appointments` (`location_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_pending_expires_idx` ON `appointments` (`expires_at`) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX `appointments_needs_reschedule_idx` ON `appointments` (`barber_id`) WHERE needs_reschedule_at is not null;--> statement-breakpoint
CREATE TABLE `barber_days_off` (
	`barber_id` text NOT NULL,
	`day` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`barber_id`, `day`),
	FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `barber_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`barber_id` text NOT NULL,
	`kind` text NOT NULL,
	`gross_amount` integer DEFAULT 0 NOT NULL,
	`rate_bps` integer,
	`amount` integer NOT NULL,
	`appointment_payment_id` text,
	`payment_id` text,
	`rent_charge_id` text,
	`sale_payment_id` text,
	`actor_id` text,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`appointment_payment_id`) REFERENCES `appointment_payments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`rent_charge_id`) REFERENCES `rent_charges`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sale_payment_id`) REFERENCES `barber_sale_payments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "barber_ledger_rate_check" CHECK("barber_ledger"."rate_bps" is null or "barber_ledger"."rate_bps" between 0 and 10000),
	CONSTRAINT "barber_ledger_adjustment_check" CHECK("barber_ledger"."kind" <> 'adjustment' or "barber_ledger"."note" is not null),
	CONSTRAINT "barber_ledger_rent_check" CHECK("barber_ledger"."kind" <> 'rent_deduction' or "barber_ledger"."rent_charge_id" is not null),
	CONSTRAINT "barber_ledger_kind_check" CHECK("barber_ledger"."kind" in ('service_share', 'product_commission', 'cash_collected', 'rent_deduction', 'payout', 'settlement', 'adjustment'))
);
--> statement-breakpoint
CREATE INDEX `barber_ledger_barber_created_idx` ON `barber_ledger` (`barber_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `barber_ledger_appointment_payment_kind_key` ON `barber_ledger` (`appointment_payment_id`,`kind`) WHERE appointment_payment_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `barber_ledger_payment_kind_key` ON `barber_ledger` (`payment_id`,`kind`) WHERE payment_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `barber_ledger_rent_charge_key` ON `barber_ledger` (`rent_charge_id`) WHERE rent_charge_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `barber_ledger_sale_payment_kind_key` ON `barber_ledger` (`sale_payment_id`,`kind`) WHERE sale_payment_id is not null;--> statement-breakpoint
CREATE TABLE `barber_locations` (
	`barber_id` text NOT NULL,
	`location_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`barber_id`, `location_id`),
	FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `barber_locations_location_idx` ON `barber_locations` (`location_id`);--> statement-breakpoint
CREATE TABLE `barber_sale_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`service_id` text,
	`variant_id` text,
	`sku_snapshot` text,
	`inventory_ledger_id` text,
	`name` text NOT NULL,
	`description` text,
	`unit_amount` integer NOT NULL,
	`qty` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `barber_sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`inventory_ledger_id`) REFERENCES `inventory_ledger`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "barber_sale_lines_values_check" CHECK("barber_sale_lines"."unit_amount" >= 0 and "barber_sale_lines"."qty" > 0),
	CONSTRAINT "barber_sale_lines_kind_check" CHECK("barber_sale_lines"."variant_id" is null or "barber_sale_lines"."service_id" is null)
);
--> statement-breakpoint
CREATE INDEX `barber_sale_lines_sale_id_idx` ON `barber_sale_lines` (`sale_id`);--> statement-breakpoint
CREATE TABLE `barber_sale_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`qpay_invoice_id` text,
	`qpay_payment_id` text,
	`invoice_payload` text,
	`raw_callback` text,
	`received_by_user_id` text,
	`paid_at` integer,
	`last_checked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `barber_sales`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`received_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "barber_sale_payments_amount_check" CHECK("barber_sale_payments"."amount" > 0),
	CONSTRAINT "barber_sale_payments_qpay_check" CHECK("barber_sale_payments"."method" = 'qpay' or "barber_sale_payments"."qpay_invoice_id" is null),
	CONSTRAINT "barber_sale_payments_paid_check" CHECK("barber_sale_payments"."status" <> 'paid' or "barber_sale_payments"."paid_at" is not null),
	CONSTRAINT "barber_sale_payments_status_check" CHECK("barber_sale_payments"."status" in ('pending', 'paid', 'failed', 'expired', 'refunded')),
	CONSTRAINT "barber_sale_payments_method_check" CHECK("barber_sale_payments"."method" in ('qpay', 'cash', 'pos', 'bank_transfer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `barber_sale_payments_qpay_payment_id_key` ON `barber_sale_payments` (`qpay_payment_id`) WHERE qpay_payment_id is not null;--> statement-breakpoint
CREATE INDEX `barber_sale_payments_sale_id_idx` ON `barber_sale_payments` (`sale_id`);--> statement-breakpoint
CREATE INDEX `barber_sale_payments_qpay_invoice_id_idx` ON `barber_sale_payments` (`qpay_invoice_id`);--> statement-breakpoint
CREATE TABLE `barber_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_no` text NOT NULL,
	`barber_id` text NOT NULL,
	`location_id` text NOT NULL,
	`appointment_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`total` integer NOT NULL,
	`credit` integer DEFAULT 0 NOT NULL,
	`note` text,
	`customer_name` text,
	`customer_phone` text,
	`customer_email` text,
	`created_by` text,
	`paid_at` integer,
	`voided_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "barber_sales_money_check" CHECK("barber_sales"."total" >= 0 and "barber_sales"."credit" >= 0 and "barber_sales"."credit" <= "barber_sales"."total"),
	CONSTRAINT "barber_sales_credit_check" CHECK("barber_sales"."appointment_id" is not null or "barber_sales"."credit" = 0),
	CONSTRAINT "barber_sales_paid_check" CHECK("barber_sales"."status" <> 'paid' or "barber_sales"."paid_at" is not null),
	CONSTRAINT "barber_sales_status_check" CHECK("barber_sales"."status" in ('open', 'paid', 'void'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `barber_sales_sale_no_key` ON `barber_sales` (`sale_no`);--> statement-breakpoint
CREATE INDEX `barber_sales_barber_created_idx` ON `barber_sales` (`barber_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `barber_sales_appointment_key` ON `barber_sales` (`appointment_id`) WHERE appointment_id is not null and status <> 'void';--> statement-breakpoint
CREATE TABLE `barber_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`barber_id` text NOT NULL,
	`location_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "barber_shifts_range_check" CHECK("barber_shifts"."ends_at" > "barber_shifts"."starts_at")
);
--> statement-breakpoint
CREATE INDEX `barber_shifts_location_starts_idx` ON `barber_shifts` (`location_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `barber_shifts_barber_starts_idx` ON `barber_shifts` (`barber_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `barber_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`barber_id` text NOT NULL,
	`service_cut_bps` integer DEFAULT 0 NOT NULL,
	`product_commission_bps` integer DEFAULT 0 NOT NULL,
	`rent_amount` integer DEFAULT 0 NOT NULL,
	`rent_period` text,
	`rent_starts_on` text,
	`effective_from` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "barber_terms_bps_check" CHECK("barber_terms"."service_cut_bps" between 0 and 10000 and "barber_terms"."product_commission_bps" between 0 and 10000),
	CONSTRAINT "barber_terms_rent_check" CHECK("barber_terms"."rent_amount" = 0 or ("barber_terms"."rent_amount" > 0 and "barber_terms"."rent_period" is not null and "barber_terms"."rent_starts_on" is not null)),
	CONSTRAINT "barber_terms_rent_period_check" CHECK("barber_terms"."rent_period" in ('weekly', 'biweekly', 'monthly'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `barber_terms_barber_effective_key` ON `barber_terms` (`barber_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `barbers` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`bio_mn` text,
	`bio_en` text,
	`photo_url` text,
	`buffer_minutes` integer DEFAULT 0 NOT NULL,
	`booking_fee` integer DEFAULT 0 NOT NULL,
	`user_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "barbers_buffer_minutes_check" CHECK("barbers"."buffer_minutes" >= 0),
	CONSTRAINT "barbers_booking_fee_check" CHECK("barbers"."booking_fee" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `barbers_slug_key` ON `barbers` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `barbers_user_id_key` ON `barbers` (`user_id`);--> statement-breakpoint
CREATE TABLE `batch_guards` (
	`code` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cart_items` (
	`id` text PRIMARY KEY NOT NULL,
	`cart_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_price_snapshot` integer NOT NULL,
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cart_items_cart_variant_key` ON `cart_items` (`cart_id`,`variant_id`);--> statement-breakpoint
CREATE TABLE `carts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`session_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carts_session_token_key` ON `carts` (`session_token`);--> statement-breakpoint
CREATE INDEX `carts_user_id_idx` ON `carts` (`user_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name_mn` text NOT NULL,
	`name_en` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_key` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `checkout_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`ip` text,
	`phone` text NOT NULL,
	`cart_id` text,
	`order_id` text,
	`outcome` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `checkout_attempts_ip_created_at_idx` ON `checkout_attempts` (`ip`,`created_at`);--> statement-breakpoint
CREATE INDEX `checkout_attempts_phone_created_at_idx` ON `checkout_attempts` (`phone`,`created_at`);--> statement-breakpoint
CREATE TABLE `in_store_sales` (
	`order_id` text PRIMARY KEY NOT NULL,
	`barber_id` text NOT NULL,
	`location_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `in_store_sales_barber_created_idx` ON `in_store_sales` (`barber_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `inventory_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`variant_id` text NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`order_id` text,
	`actor_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "inventory_ledger_reason_check" CHECK("inventory_ledger"."reason" in ('order_paid', 'order_cancelled', 'order_refunded', 'restock', 'manual_adjustment', 'pos_sale'))
);
--> statement-breakpoint
CREATE INDEX `inventory_ledger_variant_id_idx` ON `inventory_ledger` (`variant_id`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name_mn` text NOT NULL,
	`name_en` text NOT NULL,
	`address` text NOT NULL,
	`phone` text,
	`map_link` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `locations_slug_key` ON `locations` (`slug`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`variant_id` text,
	`sku_snapshot` text NOT NULL,
	`name_snapshot` text NOT NULL,
	`unit_price` integer NOT NULL,
	`qty` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `order_items_order_id_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_items_variant_id_idx` ON `order_items` (`variant_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_no` text NOT NULL,
	`user_id` text,
	`cart_id` text,
	`status` text DEFAULT 'pending_payment' NOT NULL,
	`subtotal` integer NOT NULL,
	`shipping_fee` integer NOT NULL,
	`total` integer NOT NULL,
	`shipping_address_snapshot` text NOT NULL,
	`contact_phone` text NOT NULL,
	`note` text,
	`expires_at` integer NOT NULL,
	`access_token_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "orders_status_check" CHECK("orders"."status" in ('pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'expired', 'refunded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_no_key` ON `orders` (`order_no`);--> statement-breakpoint
CREATE INDEX `orders_user_id_idx` ON `orders` (`user_id`);--> statement-breakpoint
CREATE INDEX `orders_cart_id_idx` ON `orders` (`cart_id`);--> statement-breakpoint
CREATE INDEX `orders_status_created_at_idx` ON `orders` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_pending_expires_idx` ON `orders` (`expires_at`) WHERE status = 'pending_payment';--> statement-breakpoint
CREATE TABLE `otp_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `otp_codes_email_idx` ON `otp_codes` (`email`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`provider` text DEFAULT 'qpay' NOT NULL,
	`invoice_id` text,
	`payment_id` text,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invoice_payload` text,
	`raw_callback` text,
	`paid_at` integer,
	`last_checked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payments_status_check" CHECK("payments"."status" in ('pending', 'paid', 'failed', 'expired', 'refunded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_payment_id_key` ON `payments` (`payment_id`) WHERE payment_id is not null;--> statement-breakpoint
CREATE INDEX `payments_order_id_idx` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `payments_invoice_id_idx` ON `payments` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `product_images` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`url` text NOT NULL,
	`alt` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `product_images_product_id_idx` ON `product_images` (`product_id`);--> statement-breakpoint
CREATE TABLE `product_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`sku` text NOT NULL,
	`size` text,
	`price` integer NOT NULL,
	`compare_at_price` integer,
	`stock_qty` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_variants_sku_key` ON `product_variants` (`sku`);--> statement-breakpoint
CREATE INDEX `product_variants_product_id_idx` ON `product_variants` (`product_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name_mn` text NOT NULL,
	`name_en` text NOT NULL,
	`description_mn` text,
	`description_en` text,
	`category_id` text,
	`brand_line` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "products_status_check" CHECK("products"."status" in ('draft', 'active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_key` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `products_category_id_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE INDEX `products_status_idx` ON `products` (`status`);--> statement-breakpoint
CREATE TABLE `rent_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`barber_id` text NOT NULL,
	`amount` integer NOT NULL,
	`due_on` text NOT NULL,
	`status` text DEFAULT 'due' NOT NULL,
	`paid_via` text,
	`confirmed_by` text,
	`confirmed_at` integer,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "rent_charges_amount_check" CHECK("rent_charges"."amount" > 0),
	CONSTRAINT "rent_charges_paid_check" CHECK("rent_charges"."status" <> 'paid' or "rent_charges"."paid_via" is not null),
	CONSTRAINT "rent_charges_status_check" CHECK("rent_charges"."status" in ('due', 'paid', 'waived')),
	CONSTRAINT "rent_charges_paid_via_check" CHECK("rent_charges"."paid_via" in ('direct', 'payout'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rent_charges_barber_due_key` ON `rent_charges` (`barber_id`,`due_on`);--> statement-breakpoint
CREATE INDEX `rent_charges_status_due_idx` ON `rent_charges` (`status`,`due_on`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`user_id` text NOT NULL,
	`order_id` text NOT NULL,
	`rating` integer NOT NULL,
	`body` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reviews_status_check" CHECK("reviews"."status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_product_user_order_key` ON `reviews` (`product_id`,`user_id`,`order_id`);--> statement-breakpoint
CREATE INDEX `reviews_product_id_status_idx` ON `reviews` (`product_id`,`status`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`barber_id` text NOT NULL,
	`location_id` text NOT NULL,
	`name_en` text NOT NULL,
	`name_mn` text,
	`description_en` text,
	`description_mn` text,
	`price` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`barber_id`) REFERENCES `barbers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "services_price_check" CHECK("services"."price" >= 0),
	CONSTRAINT "services_duration_check" CHECK("services"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE INDEX `services_barber_location_idx` ON `services` (`barber_id`,`location_id`);--> statement-breakpoint
CREATE INDEX `services_location_idx` ON `services` (`location_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`user_agent` text,
	`ip` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`name` text NOT NULL,
	`role` text DEFAULT 'customer' NOT NULL,
	`email_verified_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" in ('customer', 'admin'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_key` ON `users` (`email`);