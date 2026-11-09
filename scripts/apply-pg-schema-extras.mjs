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
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL ?? "";
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.log("[schema-extras] DATABASE_URL bukan Postgres — lewati (dev lokal).");
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
  try {
    execFileSync(prismaBin, ["db", "execute", "--file", full, "--schema", "prisma/schema.prisma"], {
      stdio: "inherit",
      env: process.env,
    });
  } catch {
    console.error(`[schema-extras] GAGAL menerapkan ${file} — hentikan build.`);
    process.exit(1);
  }
}
console.log(`[schema-extras] ${files.length} patch SQL diterapkan ✓`);
