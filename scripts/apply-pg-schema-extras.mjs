/**
 * Terapkan patch SQL aditif (prisma/sql/*.sql) ke database Postgres sebelum
 * `next build` — dijalankan dari script "build" package.json.
 *
 * Latar belakang: kredensial DB produksi hanya tersedia di env build Vercel
 * (tidak bisa ditarik ke lokal), sementara `prisma db push` menyinkronkan
 * SELURUH schema (berisiko drop bila ada drift). File SQL di prisma/sql/
 * ditulis murni ADITIF & IDEMPOTENT (ADD COLUMN IF NOT EXISTS) sehingga aman
 * dijalankan berulang di setiap deploy dan tidak pernah menghapus data.
 *
 * Perilaku:
 *  - DATABASE_URL bukan postgres → lewati (dev lokal, mis. SQLite/zonky).
 *  - Semua file *.sql di prisma/sql/ dijalankan berurutan (urut nama).
 *  - Salah satu gagal → build GAGAL → Vercel tetap menjalankan deploy lama.
 *    Ini disengaja: kode baru butuh kolom baru; deploy lama lebih aman daripada
 *    runtime 500 di /api/settings.
 *
 * Tanpa argumen koneksi — Prisma CLI membaca DATABASE_URL dari environment
 * (schema: prisma/schema.prisma, datasource url = env("DATABASE_URL")).
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const url = process.env.DIRECT_DATABASE_URL ?? "";
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.log("[schema-extras] DIRECT_DATABASE_URL tidak terpasang (bukan Postgres?) — lewati.");
  process.exit(0);
}

const sqlDir = path.resolve(process.cwd(), "prisma", "sql");
let files = [];
try {
  files = readdirSync(sqlDir)
    .filter((f) => f.toLowerCase().endsWith(".sql"))
    .sort();
} catch {
  console.log("[schema-extras] Tidak ada folder prisma/sql — lewati.");
  process.exit(0);
}

if (files.length === 0) {
  console.log("[schema-extras] Tidak ada file .sql — selesai.");
  process.exit(0);
}

const prismaBin = path.resolve(process.cwd(), "node_modules", ".bin", "prisma");
for (const file of files) {
  const full = path.join(sqlDir, file);
  console.log(`[schema-extras] Terapkan ${file} …`);
  const res = spawnSync(prismaBin, ["db", "execute", "--file", full, "--schema", "prisma/schema.prisma"], {
    stdio: ["ignore", "inherit", "pipe"],
    // Patch DDL berjalan lewat koneksi DIRECT (bukan pooler pgbouncer) —
    // pooler transaksi hanya utk runtime serverless, bukan DDL/CLI.
    env: { ...process.env, DATABASE_URL: url },
  });
  const errText = res.stderr ? res.stderr.toString() : "";
  if (errText) process.stderr.write(errText);
  if (res.status !== 0) {
    // v1.3.34 — KONEKSI (P1001) ≠ KEAGAGALAN SQL: gangguan jaringan build →
    // db.prisma.io dilaporkan dgn kode keluar 42 (khusus) sehingga skrip
    // build-with-retry.sh bisa membedakan "coba lagi / lanjut dgn peringatan"
    // dari kegagalan SQL sungguhan yang wajib membatalkan deploy.
    if (errText.includes("P1001") || errText.includes("Can't reach database server")) {
      console.error("[schema-extras] KONEKSI DB TAK TERJANGKAU DARI BUILD (P1001) — kode 42 (bukan kegagalan SQL)");
      process.exit(42);
    }
    console.error(`[schema-extras] GAGAL menerapkan ${file} — hentikan build.`);
    process.exit(1);
  }
}
console.log(`[schema-extras] ${files.length} patch SQL diterapkan ✓`);
