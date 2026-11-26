-- Kolom ANIMASI KURIR + TIPOGRAFI KINETIK DI BERANDA (tabel StoreSetting) —
-- konfigurasi adegan motor kurir + spanduk teks yang diatur admin dari
-- Profil → "Animasi Beranda" (saklar aktif, teks spanduk, font/gaya,
-- warna teks & aksen, ukuran huruf, kecepatan siklus, ledakan BOOM).
-- MURNI ADITIF & IDEMPOTENT: ADD COLUMN IF NOT EXISTS — aman dijalankan
-- berulang tiap build Vercel, tidak pernah menghapus/mengubah data lama.
-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.

ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "courierAnim" JSONB;
