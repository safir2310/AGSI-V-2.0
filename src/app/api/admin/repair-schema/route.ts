/**
 * [SEMENTARA — dihapus setelah perbaikan] Rute perbaikan skema darurat.
 *
 * Latar: build Vercel gagal menjangkau db.prisma.io (P1001) sehingga langkah
 * apply-pg-schema-extras dilewati; tabel "User" di DB produksi ternyata tidak
 * sinkron dgn model Prisma (findUnique login gagal 500, sementara raw SQL
 * /api/settings sehat). Rute ini menjalankan PATCH SQL ADITIF & IDEMPOTEN
 * (semua prisma/sql/*.sql + 011-user-columns) lewat RUNTIME yang terbukti
 * sehat. Seluruh isi SQL TER-EMBED agar tak bergantung bundle standalone.
 *
 * GET  /api/admin/repair-schema?key=…  → daftar kolom aktual tabel "User"
 * POST /api/admin/repair-schema?key=…  → terapkan semua patch idempoten +
 *                                        daftar kolom terbaru. Aman berulang.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const KEY = "sN1Qla3lN700ZuXImU2YpBz5tMVu8qQZ";

const EXPECTED_USER_COLUMNS = [
  "id",
  "email",
  "passwordHash",
  "name",
  "phone",
  "role",
  "points",
  "memberCode",
  "dataConsentAt",
  "dataConsentVersion",
  "appTermsAt",
  "appTermsVersion",
  "createdAt",
  "updatedAt",
];

const SQL_FILES: Record<string, string> = {
  "011-user-columns.sql": "-- ===== [011] KOLOM MODEL \"User\" TIDAK TERCAKUP PATCH 001-010 =====\n-- Model User (prisma/schema.prisma) memuat kolom persetujuan legal & kode\n-- member yang tidak punya file patch SQL sendiri. MURNI ADITIF & IDEMPOTENT.\nALTER TABLE \"User\"\n  ADD COLUMN IF NOT EXISTS \"memberCode\" TEXT,\n  ADD COLUMN IF NOT EXISTS \"dataConsentAt\" TIMESTAMP(3),\n  ADD COLUMN IF NOT EXISTS \"dataConsentVersion\" TEXT,\n  ADD COLUMN IF NOT EXISTS \"appTermsAt\" TIMESTAMP(3),\n  ADD COLUMN IF NOT EXISTS \"appTermsVersion\" TEXT;\n\nCREATE UNIQUE INDEX IF NOT EXISTS \"User_memberCode_key\" ON \"User\"(\"memberCode\");\n",
  "001-menu-promo-columns.sql": "-- Kolom slide voucher di carousel Menu (tabel StoreSetting).\n-- MURNI ADITIF & IDEMPOTENT: ADD COLUMN IF NOT EXISTS \u2014 aman dijalankan\n-- berulang tiap build Vercel, tidak pernah menghapus/mengubah data lama.\n-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"menuPromoVouchersEnabled\" BOOLEAN NOT NULL DEFAULT true;\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"menuPromoVouchersMax\" INTEGER NOT NULL DEFAULT 3;\n",
  "002-menu-promo-banner-columns.sql": "-- Kolom 2 banner promo custom di carousel Menu (tabel StoreSetting).\n-- MURNI ADITIF & IDEMPOTENT: ADD COLUMN IF NOT EXISTS \u2014 aman dijalankan\n-- berulang tiap build Vercel, tidak pernah menghapus/mengubah data lama.\n-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"menuPromoBanners\" JSONB;\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"menuPromoBannersUpdatedAt\" TIMESTAMP(3);\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"menuPromoBanner1ImageData\" TEXT;\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"menuPromoBanner1ImageMime\" TEXT;\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"menuPromoBanner2ImageData\" TEXT;\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"menuPromoBanner2ImageMime\" TEXT;\n",
  "003-order-qris-declared-at.sql": "-- Kolom jejak deklarasi manual pembayaran QRIS statis (tabel \"Order\").\n-- POST /api/orders/[id]/qris/declare menandai waktu pelanggan mendeklarasikan\n-- pembayaran; NULL berarti pelunasan lewat webhook gateway (otomatis).\n-- MURNI ADITIF & IDEMPOTENT: ADD COLUMN IF NOT EXISTS \u2014 aman dijalankan\n-- berulang tiap build Vercel, tidak pernah menghapus/mengubah data lama.\n-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.\n\nALTER TABLE \"Order\"\n  ADD COLUMN IF NOT EXISTS \"qrisDeclaredAt\" TIMESTAMP(3);\n",
  "004-order-courier-tracking.sql": "-- Kolom pelacakan kurir AGSI untuk pesanan ANTAR (tabel \"Order\").\n-- Staff menandai \"Serahkan ke Kurir\" (nama kurir + no. HP opsional) saat\n-- pesanan READY \u2192 onTheWayAt jadi penanda \"sedang diantar\" untuk fitur\n-- Lacak Kurir di Profil pelanggan. NULL = kurir belum berangkat.\n-- MURNI ADITIF & IDEMPOTENT: ADD COLUMN IF NOT EXISTS \u2014 aman dijalankan\n-- berulang tiap build Vercel, tidak pernah menghapus/mengubah data lama.\n-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.\n\nALTER TABLE \"Order\"\n  ADD COLUMN IF NOT EXISTS \"courierName\" TEXT,\n  ADD COLUMN IF NOT EXISTS \"courierPhone\" TEXT,\n  ADD COLUMN IF NOT EXISTS \"onTheWayAt\" TIMESTAMP(3);\n",
  "005-courier-account-gps.sql": "-- Akun kurir AGSI (role COURIER) + pin GPS lokasi rumah pelanggan (Order).\n--\n-- 1. courierUserId: terisi saat staff menugaskan AKUN kurir (role COURIER)\n--    lewat \"Serahkan ke Kurir\" \u2192 akun kurir itu melihat pesanan lengkap\n--    dengan alamat akurat & pin GPS di beranda kurirnya. NULL = kurir luar\n--    (penugasan lama yang hanya mencatat nama bebas).\n-- 2. deliveryLat/deliveryLng: pin GPS lokasi rumah pelanggan yang ditempel\n--    saat checkout DELIVERY (opsional) \u2014 kurir membuka Google Maps langsung\n--    ke titik presisi ini, bukan cuma nama gampong.\n--\n-- MURNI ADITIF & IDEMPOTENT: ADD COLUMN IF NOT EXISTS \u2014 aman dijalankan\n-- berulang tiap build Vercel, tidak pernah menghapus/mengubah data lama.\n-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.\n-- (Role COURIER tidak butuh kolom baru di tabel \"User\" \u2014 kolom role sudah\n--  bertipe TEXT dan nilai baru tinggal dipakai.)\n\nALTER TABLE \"Order\"\n  ADD COLUMN IF NOT EXISTS \"courierUserId\" TEXT,\n  ADD COLUMN IF NOT EXISTS \"deliveryLat\" DOUBLE PRECISION,\n  ADD COLUMN IF NOT EXISTS \"deliveryLng\" DOUBLE PRECISION;\n",
  "006-courier-cod-setoran.sql": "-- ===== UANG COD KURIR: SETORAN KE ADMIN =====\n--\n-- Kurir antar yang menerima uang tunai pelanggan (COD / bayar di tempat)\n-- mengumpulkan uang di tangan dan WAJIB menyetorkannya ke admin:\n--  1. Order.codSetoranId: ikatan pesanan \u2192 setoran. NULL = uang masih di\n--     tangan kurir (belum disetor) atau bukan pesanan COD kurir.\n--  2. Tabel CourierSetoran: bukti setoran (jumlah, banyak pesanan, catatan,\n--     waktu, konfirmasi admin) \u2014 riwayat transparan dua pihak.\n--\n-- Nilai paidVia \"COD\" diisi saat kurir menyelesaikan pesanan antar tunai\n-- yang belum lunas \u2014 penanda uang berpindah ke tangan kurir (kolom TEXT\n-- sudah ada, tidak butuh DDL).\n--\n-- MURNI ADITIF & IDEMPOTENT: aman dijalankan berulang tiap build Vercel,\n-- tidak pernah menghapus/mengubah data lama. Dijalankan otomatis oleh\n-- scripts/apply-pg-schema-extras.mjs sebelum next build.\n\nCREATE TABLE IF NOT EXISTS \"CourierSetoran\" (\n  \"id\"            TEXT       NOT NULL,\n  \"courierUserId\" TEXT       NOT NULL,\n  \"amount\"        INTEGER    NOT NULL,\n  \"orderCount\"    INTEGER    NOT NULL,\n  \"note\"          TEXT,\n  \"createdAt\"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  \"confirmedAt\"   TIMESTAMP(3),\n\n  CONSTRAINT \"CourierSetoran_pkey\" PRIMARY KEY (\"id\")\n);\n\nALTER TABLE \"Order\"\n  ADD COLUMN IF NOT EXISTS \"codSetoranId\" TEXT;\n\n-- Indeks pencarian (idempoten: buat hanya bila belum ada)\nCREATE INDEX IF NOT EXISTS \"CourierSetoran_courierUserId_idx\"\n  ON \"CourierSetoran\"(\"courierUserId\");\nCREATE INDEX IF NOT EXISTS \"CourierSetoran_createdAt_idx\"\n  ON \"CourierSetoran\"(\"createdAt\");\nCREATE INDEX IF NOT EXISTS \"Order_codSetoranId_idx\"\n  ON \"Order\"(\"codSetoranId\");\n\n-- Relasi FK (idempoten lewat pengecekan pg_constraint \u2014 Postgres tidak\n-- mendukung ADD CONSTRAINT IF NOT EXISTS)\nDO $$\nBEGIN\n  IF NOT EXISTS (\n    SELECT 1 FROM pg_constraint WHERE conname = 'Order_codSetoranId_fkey'\n  ) THEN\n    ALTER TABLE \"Order\"\n      ADD CONSTRAINT \"Order_codSetoranId_fkey\"\n      FOREIGN KEY (\"codSetoranId\") REFERENCES \"CourierSetoran\"(\"id\")\n      ON DELETE SET NULL ON UPDATE CASCADE;\n  END IF;\n  IF NOT EXISTS (\n    SELECT 1 FROM pg_constraint WHERE conname = 'CourierSetoran_courierUserId_fkey'\n  ) THEN\n    ALTER TABLE \"CourierSetoran\"\n      ADD CONSTRAINT \"CourierSetoran_courierUserId_fkey\"\n      FOREIGN KEY (\"courierUserId\") REFERENCES \"User\"(\"id\")\n      ON DELETE CASCADE ON UPDATE CASCADE;\n  END IF;\nEND $$;\n",
  "007-courier-setoran-ongkir.sql": "-- ===== SETORAN COD KURIR: ONGKIR = PENDAPATAN KURIR =====\n--\n-- Aturan uang COD diperjelas:\n--  - Kurir menerima uang PENUH dari pelanggan (total = menu + ongkir).\n--  - Yang disetor ke admin hanya NOMINAL PESANAN (uang menu) =\n--    total \u2212 ongkir.\n--  - Ongkir (deliveryFee) = PENDAPATAN KURIR \u2014 tetap di kurir, tidak ikut\n--    disetor. Kolom CourierSetoran.ongkir mencatat pendapatan kurir dari\n--    pesanan yang diikat setoran ini (transparan untuk admin).\n--\n-- MURNI ADITIF & IDEMPOTENT: aman dijalankan berulang tiap build Vercel.\n-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.\n\nALTER TABLE \"CourierSetoran\"\n  ADD COLUMN IF NOT EXISTS \"ongkir\" INTEGER NOT NULL DEFAULT 0;\n",
  "008-store-ewallet-enabled.sql": "-- 008: saklar pembayaran E-WALLET terpisah dari QRIS (StoreSetting).\n-- Admin dapat menonaktifkan pembayaran e-wallet (halaman DOKU: DOKU Wallet /\n-- DANA / OVO / ShopeePay) tanpa mematikan QRIS \u2014 Profil Admin \u2192 \"Pengaturan Toko\".\n-- Default AKTIF (true) agar toko yang sudah berjalan tidak berubah perilaku.\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"ewalletEnabled\" BOOLEAN NOT NULL DEFAULT true;\n",
  "009-video-promo.sql": "-- Kolom AGSI Smart Video Promo Banner (tabel StoreSetting) \u2014 carousel video\n-- MP4 di dasar halaman Menu: autoplay, loop, bisa digeser seperti carousel,\n-- klik untuk membuka produk/promo, responsif Android & desktop.\n-- MURNI ADITIF & IDEMPOTENT: ADD COLUMN IF NOT EXISTS \u2014 aman dijalankan\n-- berulang tiap build Vercel, tidak pernah menghapus/mengubah data lama.\n-- Dijalankan otomatis oleh scripts/apply-pg-schema-extras.mjs sebelum next build.\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"videoPromoEnabled\" BOOLEAN NOT NULL DEFAULT false;\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"videoPromoSlides\" JSONB;\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"videoPromoUpdatedAt\" TIMESTAMP(3);\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"videoPromoSlot1Data\" TEXT;\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"videoPromoSlot1Mime\" TEXT;\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"videoPromoSlot2Data\" TEXT;\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"videoPromoSlot2Mime\" TEXT;\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"videoPromoSlot3Data\" TEXT;\n\nALTER TABLE \"StoreSetting\"\n  ADD COLUMN IF NOT EXISTS \"videoPromoSlot3Mime\" TEXT;\n",
  "010-repair-media-version.sql": "-- 010: perbaiki baris media lama yang datanya ada tapi kolom VERSI masih NULL.\n--\n-- Latar belakang: build lama menyimpan bytes gambar/video TANPA menulis\n-- kolom mime & timestamp versi bersamaan. Lapisan baca kini menganggap media\n-- ada cukup dari keberadaan DATA (mime ditebak dari magic bytes di\n-- src/lib/serve-image.ts), TAPI versi yang NULL membuat URL cache-buster\n-- memakai konstanta \"1\" \u2014 naikkan ke NOW() agar klien mengambil gambar baru\n-- dan popup banner tampil lagi (versi dianggap berubah).\n-- Idempotent: hanya menyentuh baris ber-data dengan versi NULL.\n\nUPDATE \"StoreSetting\" SET \"bannerUpdatedAt\" = NOW()\n  WHERE \"bannerImageData\" IS NOT NULL AND \"bannerUpdatedAt\" IS NULL;\n\nUPDATE \"StoreSetting\" SET \"menuHeroUpdatedAt\" = NOW()\n  WHERE \"menuHeroImageData\" IS NOT NULL AND \"menuHeroUpdatedAt\" IS NULL;\n\nUPDATE \"StoreSetting\" SET \"menuPromoBannersUpdatedAt\" = NOW()\n  WHERE (\"menuPromoBanner1ImageData\" IS NOT NULL OR \"menuPromoBanner2ImageData\" IS NOT NULL)\n    AND \"menuPromoBannersUpdatedAt\" IS NULL;\n\nUPDATE \"StoreSetting\" SET \"videoPromoUpdatedAt\" = NOW()\n  WHERE (\"videoPromoSlot1Data\" IS NOT NULL OR \"videoPromoSlot2Data\" IS NOT NULL OR \"videoPromoSlot3Data\" IS NOT NULL)\n    AND \"videoPromoUpdatedAt\" IS NULL;\n"
};

/** Pisahkan isi SQL menjadi pernyataan tunggal pada ';' di luar blok $$ */
function splitStatements(text: string): string[] {
  const statements: string[] = [];
  let buf = "";
  let inDollar = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/--.*$/, "");
    buf += line + "\n";
    const t = line.trim();
    if (/\$\$\s*;?\s*$/.test(t)) inDollar = !inDollar;
    if (!inDollar && buf.trim().endsWith(";")) {
      const s = buf.trim().slice(0, -1).trim();
      if (s) statements.push(s);
      buf = "";
    }
  }
  const rest = buf.trim();
  if (rest) statements.push(rest);
  return statements;
}

async function userColumns() {
  return db.$queryRawUnsafe<{ column_name: string; data_type: string }[]>(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'User' ORDER BY ordinal_position`,
  );
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== KEY) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const cols = await userColumns();
    const have = new Set(cols.map((c) => c.column_name));
    const missing = EXPECTED_USER_COLUMNS.filter((c) => !have.has(c));
    return NextResponse.json({ columns: cols, missing });
  } catch (e) {
    return NextResponse.json(
      { error: String((e as Error)?.message ?? e).slice(0, 500) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== KEY) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const applied: { file: string; statements: number; skipped?: string[] }[] = [];
  try {
    for (const [file, text] of Object.entries(SQL_FILES)) {
      const skipped: string[] = [];
      const statements = splitStatements(text);
      for (const st of statements) {
        try {
          await db.$executeRawUnsafe(st);
        } catch (err) {
          const msg = String((err as Error)?.message ?? err);
          if (/already exists|duplicate/i.test(msg)) {
            skipped.push(msg.slice(0, 120));
            continue;
          }
          throw err;
        }
      }
      applied.push({ file, statements: statements.length, skipped });
    }
    const cols = await userColumns();
    const have = new Set(cols.map((c) => c.column_name));
    const missing = EXPECTED_USER_COLUMNS.filter((c) => !have.has(c));
    return NextResponse.json({ ok: true, applied, columns: cols, missing });
  } catch (e) {
    return NextResponse.json(
      { applied, error: String((e as Error)?.message ?? e).slice(0, 500) },
      { status: 500 },
    );
  }
}
