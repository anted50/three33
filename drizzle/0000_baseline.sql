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
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`booking_no` text NOT NULL,
	`service_id` text,
	`service_name` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`customer_name` text NOT NULL,
	`customer_phone` text NOT NULL,
	`customer_email` text NOT NULL,
	`note` text,
	`booking_fee` integer NOT NULL,
	`qpay_invoice_id` text,
	`qpay_payment_id` text,
	`invoice_payload` text,
	`last_checked_at` integer,
	`paid_at` integer,
	`expires_at` integer,
	`confirmation_sent_at` integer,
	`cancelled_at` integer,
	`access_token_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "appointments_status_check" CHECK("appointments"."status" in ('pending', 'booked', 'cancelled')),
	CONSTRAINT "appointments_times_check" CHECK("appointments"."ends_at" > "appointments"."starts_at" and "appointments"."duration_minutes" > 0),
	CONSTRAINT "appointments_fee_check" CHECK("appointments"."booking_fee" > 0),
	CONSTRAINT "appointments_pending_check" CHECK("appointments"."status" <> 'pending' or "appointments"."expires_at" is not null),
	CONSTRAINT "appointments_booked_check" CHECK("appointments"."status" = 'pending' or "appointments"."paid_at" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_booking_no_key` ON `appointments` (`booking_no`);--> statement-breakpoint
CREATE INDEX `appointments_starts_idx` ON `appointments` (`starts_at`);--> statement-breakpoint
CREATE INDEX `appointments_pending_expires_idx` ON `appointments` (`expires_at`) WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_qpay_payment_id_key` ON `appointments` (`qpay_payment_id`) WHERE qpay_payment_id is not null;--> statement-breakpoint
CREATE TABLE `availability` (
	`id` text PRIMARY KEY NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "availability_range_check" CHECK("availability"."ends_at" > "availability"."starts_at")
);
--> statement-breakpoint
CREATE INDEX `availability_starts_idx` ON `availability` (`starts_at`);--> statement-breakpoint
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
	CONSTRAINT "inventory_ledger_reason_check" CHECK("inventory_ledger"."reason" in ('order_paid', 'order_cancelled', 'order_refunded', 'restock', 'manual_adjustment'))
);
--> statement-breakpoint
CREATE INDEX `inventory_ledger_variant_id_idx` ON `inventory_ledger` (`variant_id`);--> statement-breakpoint
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
	`name` text NOT NULL,
	`description` text,
	`duration_minutes` integer NOT NULL,
	`price` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "services_duration_check" CHECK("services"."duration_minutes" > 0),
	CONSTRAINT "services_price_check" CHECK("services"."price" is null or "services"."price" >= 0)
);
--> statement-breakpoint
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