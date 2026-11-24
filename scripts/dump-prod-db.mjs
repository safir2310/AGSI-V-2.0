/**
 * dump-prod-db.mjs — BACKUP semua tabel produksi (db.prisma.io) ke file JSON.
 * Jalan SECEPATNYA setelah instance di-resume di console.prisma.io — instance
 * free tier yang berulang kali pause bisa hilang (deprovision) tanpa peringatan.
 *
 * Pemakaian: node /home/z/my-project/scripts/dump-prod-db.mjs
 * URL dibaca dari PRISMA_SETUP.md — tidak pernah dicetak.
 * Hasil: /home/z/my-project/db/dump-prod-<timestamp>.json
 */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";

// URL ASLI dari Vercel storage store (scripts/.dburl-prisma-blue); fallback dokumen.
const REAL = "/home/z/my-project/scripts/.dburl-prisma-blue";
let url = existsSync(REAL)
  ? readFileSync(REAL, "utf8").trim()
  : readFileSync("/home/z/my-project/PRISMA_SETUP.md", "utf8")
      .match(/postgres(?:ql)?:\/\/[^"\s]+db\.prisma\.io[^"\s]*/)?.[0] ?? "";
if (!url) {
  console.log("URL tidak ditemukan");
  process.exit(3);
}

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient({ datasources: { db: { url } } });

try {
  const tabs = await db.$queryRawUnsafe(
    `SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  console.log(`Tabel ditemukan: ${tabs.map((x) => x.t).join(", ")}`);
  const out = { dumpedAt: new Date().toISOString(), tables: {} };
  for (const { t } of tabs) {
    const rows = await db.$queryRawUnsafe(`SELECT * FROM "${t}"`);
    out.tables[t] = rows;
    console.log(`  ${t.padEnd(28)} ${rows.length} baris`);
  }
  mkdirSync("/home/z/my-project/db", { recursive: true });
  const f = `/home/z/my-project/db/dump-prod-${Date.now()}.json`;
  writeFileSync(f, JSON.stringify(out));
  console.log(`✓ BACKUP UTUH → ${f}`);
} catch (e) {
  console.log(
    `GAGAL — ${String(e?.message ?? e).replace(/postgres(ql)?:\/\/[^@\s]+@/g, "postgres://***@").slice(0, 200)}`
  );
  process.exit(1);
} finally {
  await db.$disconnect();
}
