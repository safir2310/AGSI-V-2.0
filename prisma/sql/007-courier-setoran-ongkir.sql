-- ===== SETORAN COD KURIR: ONGKIR = PENDAPATAN KURIR =====
--
-- Aturan uang COD diperjelas:
--  - Kurir menerima uang PENUH dari pelanggan (total = menu + ongkir).
--  - Yang disetor ke admin hanya NOMINAL PESANAN (uang menu) =
--    total − ongkir.
--  - Ongkir (deliveryFee) = PENDAPATAN KURIR — tetap di kurir, tidak ikut
--    disetor. Kolom CourierSetoran.ongkir mencatat pendapatan kurir dari
--    pesanan yang diikat setoran ini (transparan untuk admin).
--
-- MURNI ADITIF & IDEMPOTENT: aman dijalankan berulang tiap build Vercel.
-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.

ALTER TABLE "CourierSetoran"
  ADD COLUMN IF NOT EXISTS "ongkir" INTEGER NOT NULL DEFAULT 0;
