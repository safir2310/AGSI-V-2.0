-- Kolom pelacakan kurir AGSI untuk pesanan ANTAR (tabel "Order").
-- Staff menandai "Serahkan ke Kurir" (nama kurir + no. HP opsional) saat
-- pesanan READY → onTheWayAt jadi penanda "sedang diantar" untuk fitur
-- Lacak Kurir di Profil pelanggan. NULL = kurir belum berangkat.
-- MURNI ADITIF & IDEMPOTENT: ADD COLUMN IF NOT EXISTS — aman dijalankan
-- berulang tiap build Vercel, tidak pernah menghapus/mengubah data lama.
-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "courierName" TEXT,
  ADD COLUMN IF NOT EXISTS "courierPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "onTheWayAt" TIMESTAMP(3);
