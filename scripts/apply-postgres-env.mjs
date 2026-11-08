/**
 * GANTI DATABASE_URL → Prisma Postgres + tambah PRISMA_DATABASE_URL & POSTGRES_URL
 * (nilai sama). FIREBASE_* dan TURSO_* dipertahankan. Backup: .env.pg.bak
 *
 * Koneksi TIDAK di-hardcode — kirim lewat env saat menjalankan:
 *   PG_URL="postgres://user:pass@db.prisma.io:5432/postgres?sslmode=require" \
 *     bun scripts/apply-postgres-env.mjs
 */
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ENV = resolve(ROOT, ".env");
const PG_URL = process.env.PG_URL?.trim();
if (!PG_URL || !/^postgres(ql)?:\/\//.test(PG_URL)) {
  console.error("✗ set env PG_URL dulu, contoh:");
  console.error('  PG_URL="postgres://user:pass@db.prisma.io:5432/postgres?sslmode=require" bun scripts/apply-postgres-env.mjs');
  process.exit(1);
}

const current = readFileSync(ENV, "utf8");
copyFileSync(ENV, resolve(ROOT, ".env.pg.bak"));

const lines = current.split("\n");
const out = [];
let sawDb = false;
for (const line of lines) {
  const key = line.match(/^\s*(export\s+)?([A-Z_]+)\s*=/)?.[2];
  if (key === "DATABASE_URL") {
    if (!sawDb) {
      out.push(`DATABASE_URL="${PG_URL}"`);
      sawDb = true;
    }
    continue; // buang duplikat lama
  }
  if (key === "PRISMA_DATABASE_URL" || key === "POSTGRES_URL") continue;
  out.push(line);
}
if (!sawDb) out.unshift(`DATABASE_URL="${PG_URL}"`);

const next = [
  ...out.filter((l) => l.trim() !== "" || true),
  "",
  "# ===== Prisma Postgres (db.prisma.io) — dipakai CLI & runtime, siap deploy Vercel =====",
  `PRISMA_DATABASE_URL="${PG_URL}"`,
  `POSTGRES_URL="${PG_URL}"`,
  "",
].join("\n");

writeFileSync(ENV, next);

// konfirmasi tanpa mencetak nilai penuh
const mask = (s) => s.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@");
console.log("✓ .env diperbarui (backup: .env.pg.bak)");
for (const k of ["DATABASE_URL", "PRISMA_DATABASE_URL", "POSTGRES_URL"]) {
  const m = next.match(new RegExp(`^${k}="(.*)"$`, "m"));
  console.log(`  ${k}=${m ? mask(m[1]) : "(TIDAK ADA!)"}`);
}
const fire = next.match(/^FIREBASE_PROJECT_ID=(.*)$/m);
console.log(`  FIREBASE_* tetap ada: ${fire ? "✓" : "HILANG!"}`);
