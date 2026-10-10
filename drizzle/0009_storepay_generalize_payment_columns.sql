ALTER TABLE "payments" RENAME COLUMN "qpay_invoice_id" TO "invoice_id";--> statement-breakpoint
ALTER TABLE "payments" RENAME COLUMN "qpay_payment_id" TO "payment_id";--> statement-breakpoint
ALTER INDEX "payments_qpay_payment_id_key" RENAME TO "payments_payment_id_key";--> statement-breakpoint
ALTER INDEX "payments_qpay_invoice_id_idx" RENAME TO "payments_invoice_id_idx";
