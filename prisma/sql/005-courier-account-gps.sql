-- Akun kurir AGSI (role COURIER) + pin GPS lokasi rumah pelanggan (Order).
--
-- 1. courierUserId: terisi saat staff menugaskan AKUN kurir (role COURIER)
--    lewat "Serahkan ke Kurir" → akun kurir itu melihat pesanan lengkap
--    dengan alamat akurat & pin GPS di beranda kurirnya. NULL = kurir luar
--    (penugasan lama yang hanya mencatat nama bebas).
-- 2. deliveryLat/deliveryLng: pin GPS lokasi rumah pelanggan yang ditempel
--    saat checkout DELIVERY (opsional) — kurir membuka Google Maps langsung
--    ke titik presisi ini, bukan cuma nama gampong.
--
-- MURNI ADITIF & IDEMPOTENT: ADD COLUMN IF NOT EXISTS — aman dijalankan
-- berulang tiap build Vercel, tidak pernah menghapus/mengubah data lama.
-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.
-- (Role COURIER tidak butuh kolom baru di tabel "User" — kolom role sudah
--  bertipe TEXT dan nilai baru tinggal dipakai.)

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "courierUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveryLat" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "deliveryLng" DOUBLE PRECISION;
