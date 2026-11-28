-- ===== [011] KOLOM MODEL "User" TIDAK TERCAKUP PATCH 001-010 =====
-- Model User (prisma/schema.prisma) memuat kolom persetujuan legal & kode
-- member yang tidak punya file patch SQL sendiri; ditambahkan v1.3.34 setelah
-- ditemukan tabel "User" produksi tak sinkron saat gangguan koneksi
-- db.prisma.io (login findUnique 500). MURNI ADITIF & IDEMPOTENT — aman
-- dijalankan berulang tiap build Vercel, tidak pernah menghapus data.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "memberCode" TEXT,
  ADD COLUMN IF NOT EXISTS "dataConsentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dataConsentVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "appTermsAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "appTermsVersion" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_memberCode_key" ON "User"("memberCode");
