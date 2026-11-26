-- 012-courier-live-location.sql — posisi LANGSUNG kurir utk pelacakan real-time
-- (permintaan pemilik: pelanggan melihat kurir bergerak di peta, kurir melihat
-- pin pelanggan). ADITIF & IDEMPOTENT — aman dijalankan berulang tiap deploy.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "courierLat"   DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "courierLng"   DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "courierLocAt" TIMESTAMP(3);
