-- 014-order-pickup-at.sql — JADWAL JAM PENGAMBILAN pesanan "Bungkus / Ambil"
-- (permintaan pemilik): pelanggan TAKEAWAY bisa memilih slot jam datang
-- mengambil pesanan (hari ini / besok, grid 30 menit) di halaman keranjang.
-- Dapur melihat jadwal ini di daftar pesanan admin & struk.
-- NULL = ambil sekarang (tanpa jadwal) — perilaku lama tak berubah.
-- MURNI ADITIF & IDEMPOTENT — aman dijalankan berulang tiap deploy
-- (scripts/apply-pg-schema-extras.mjs).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "pickupAt" TIMESTAMP(3);
