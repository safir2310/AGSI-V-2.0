-- 008: saklar pembayaran E-WALLET terpisah dari QRIS (StoreSetting).
-- Admin dapat menonaktifkan pembayaran e-wallet (halaman DOKU: DOKU Wallet /
-- DANA / OVO / ShopeePay) tanpa mematikan QRIS — Profil Admin → "Pengaturan Toko".
-- Default AKTIF (true) agar toko yang sudah berjalan tidak berubah perilaku.
ALTER TABLE "StoreSetting"
  ADD COLUMN IF NOT EXISTS "ewalletEnabled" BOOLEAN NOT NULL DEFAULT true;
