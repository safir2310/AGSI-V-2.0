-- Kolom slide voucher di carousel Menu (tabel StoreSetting).
-- MURNI ADITIF & IDEMPOTENT: ADD COLUMN IF NOT EXISTS — aman dijalankan
-- berulang tiap build Vercel, tidak pernah menghapus/mengubah data lama.
-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "menuPromoVouchersEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "menuPromoVouchersMax" INTEGER NOT NULL DEFAULT 3;
