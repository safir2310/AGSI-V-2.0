-- Kolom jejak deklarasi manual pembayaran QRIS statis (tabel "Order").
-- POST /api/orders/[id]/qris/declare menandai waktu pelanggan mendeklarasikan
-- pembayaran; NULL berarti pelunasan lewat webhook gateway (otomatis).
-- MURNI ADITIF & IDEMPOTENT: ADD COLUMN IF NOT EXISTS — aman dijalankan
-- berulang tiap build Vercel, tidak pernah menghapus/mengubah data lama.
-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "qrisDeclaredAt" TIMESTAMP(3);
