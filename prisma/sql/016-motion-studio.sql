-- AGSI Motion Studio — kolom konfigurasi animasi (satu JSON, pola courierAnim).
-- Patch murni ADITIF & IDEMPOTENT — aman dijalankan berulang di setiap deploy.
ALTER TABLE "StoreSetting" ADD COLUMN IF NOT EXISTS "motion" JSONB;
