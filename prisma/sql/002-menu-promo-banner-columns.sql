-- Kolom 2 banner promo custom di carousel Menu (tabel StoreSetting).
-- MURNI ADITIF & IDEMPOTENT: ADD COLUMN IF NOT EXISTS — aman dijalankan
-- berulang tiap build Vercel, tidak pernah menghapus/mengubah data lama.
-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "menuPromoBanners" JSONB;

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "menuPromoBannersUpdatedAt" TIMESTAMP(3);

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "menuPromoBanner1ImageData" TEXT;

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "menuPromoBanner1ImageMime" TEXT;

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "menuPromoBanner2ImageData" TEXT;

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "menuPromoBanner2ImageMime" TEXT;
