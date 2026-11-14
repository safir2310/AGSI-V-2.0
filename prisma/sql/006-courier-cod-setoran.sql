-- ===== UANG COD KURIR: SETORAN KE ADMIN =====
--
-- Kurir antar yang menerima uang tunai pelanggan (COD / bayar di tempat)
-- mengumpulkan uang di tangan dan WAJIB menyetorkannya ke admin:
--  1. Order.codSetoranId: ikatan pesanan → setoran. NULL = uang masih di
--     tangan kurir (belum disetor) atau bukan pesanan COD kurir.
--  2. Tabel CourierSetoran: bukti setoran (jumlah, banyak pesanan, catatan,
--     waktu, konfirmasi admin) — riwayat transparan dua pihak.
--
-- Nilai paidVia "COD" diisi saat kurir menyelesaikan pesanan antar tunai
-- yang belum lunas — penanda uang berpindah ke tangan kurir (kolom TEXT
-- sudah ada, tidak butuh DDL).
--
-- MURNI ADITIF & IDEMPOTENT: aman dijalankan berulang tiap build Vercel,
-- tidak pernah menghapus/mengubah data lama. Dijalankan otomatis oleh
-- scripts/apply-pg-schema-extras.mjs sebelum next build.

CREATE TABLE IF NOT EXISTS "CourierSetoran" (
  "id"            TEXT       NOT NULL,
  "courierUserId" TEXT       NOT NULL,
  "amount"        INTEGER    NOT NULL,
  "orderCount"    INTEGER    NOT NULL,
  "note"          TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt"   TIMESTAMP(3),

  CONSTRAINT "CourierSetoran_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "codSetoranId" TEXT;

-- Indeks pencarian (idempoten: buat hanya bila belum ada)
CREATE INDEX IF NOT EXISTS "CourierSetoran_courierUserId_idx"
  ON "CourierSetoran"("courierUserId");
CREATE INDEX IF NOT EXISTS "CourierSetoran_createdAt_idx"
  ON "CourierSetoran"("createdAt");
CREATE INDEX IF NOT EXISTS "Order_codSetoranId_idx"
  ON "Order"("codSetoranId");

-- Relasi FK (idempoten lewat pengecekan pg_constraint — Postgres tidak
-- mendukung ADD CONSTRAINT IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Order_codSetoranId_fkey'
  ) THEN
    ALTER TABLE "Order"
      ADD CONSTRAINT "Order_codSetoranId_fkey"
      FOREIGN KEY ("codSetoranId") REFERENCES "CourierSetoran"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CourierSetoran_courierUserId_fkey'
  ) THEN
    ALTER TABLE "CourierSetoran"
      ADD CONSTRAINT "CourierSetoran_courierUserId_fkey"
      FOREIGN KEY ("courierUserId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
