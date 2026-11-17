-- Kolom AGSI Smart Video Promo Banner (tabel StoreSetting) — carousel video
-- MP4 di dasar halaman Menu: autoplay, loop, bisa digeser seperti carousel,
-- klik untuk membuka produk/promo, responsif Android & desktop.
-- MURNI ADITIF & IDEMPOTENT: ADD COLUMN IF NOT EXISTS — aman dijalankan
-- berulang tiap build Vercel, tidak pernah menghapus/mengubah data lama.
-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "videoPromoEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "videoPromoSlides" JSONB;

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "videoPromoUpdatedAt" TIMESTAMP(3);

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "videoPromoSlot1Data" TEXT;

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "videoPromoSlot1Mime" TEXT;

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "videoPromoSlot2Data" TEXT;

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "videoPromoSlot2Mime" TEXT;

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "videoPromoSlot3Data" TEXT;

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "videoPromoSlot3Mime" TEXT;
