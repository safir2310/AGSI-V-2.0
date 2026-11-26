-- 013-delivery-photo.sql — BUKTI FOTO PENGIRIMAN KURIR (permintaan pemilik):
-- kurir wajib mengunggah foto sebelum "Sampai Tujuan"; admin & pelanggan
-- melihatnya dari detail pesanan/lacak. MURNI ADITIF & IDEMPOTENT — aman
-- dijalankan berulang tiap deploy (scripts/apply-pg-schema-extras.mjs).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryPhotoAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "DeliveryPhoto" (
  "id"               TEXT NOT NULL,
  "orderId"          TEXT NOT NULL,
  "data"             TEXT NOT NULL,
  "mime"             TEXT,
  "uploadedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploadedByUserId" TEXT,
  "uploadedByName"   TEXT,

  CONSTRAINT "DeliveryPhoto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryPhoto_orderId_key" ON "DeliveryPhoto"("orderId");
CREATE INDEX IF NOT EXISTS "DeliveryPhoto_uploadedAt_idx" ON "DeliveryPhoto"("uploadedAt");
