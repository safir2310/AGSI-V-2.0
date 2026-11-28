-- 018-qris-web-checkout.sql (2026-11-26) — DOKU Checkout GANDA utk QR QRIS asli:
-- kartu QR menampilkan halaman QRIS DOKU asli (checkout QRIS-only, invoice
-- dasar); checkout kedua "semua metode" (DOKU Wallet, VA, dll.) disimpan di
-- kolom ini — pelanggan boleh lunas lewat salah satu dari kedua invoice.
-- ADITIF & IDEMPOTENT (aman dijalankan berulang di setiap deploy).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "qrisWebTrxId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "qrisWebUrl" TEXT;
