/**
 * test-prod-db.mjs — tes koneksi DB produksi (db.prisma.io) langsung dari sandbox
 * memakai @prisma/client proyek. URL diambil dari PRISMA_SETUP.md — TIDAK
 * dicetak. Output hanya klasifikasi hasil (kode error + pesan tersamarkan).
 */
import { readFileSync, existsSync } from "node:fs";

// Prioritas: URL ASLI dari Vercel storage store (scripts/.dburl-prisma-blue).
// PRISMA_SETUP.md hanya placeholder — bukan kredensial sungguhan.
const REAL = "/home/z/my-project/scripts/.dburl-prisma-blue";
let url = existsSync(REAL)
  ? readFileSync(REAL, "utf8").trim()
  : readFileSync("/home/z/my-project/PRISMA_SETUP.md", "utf8")
      .match(/postgres(?:ql)?:\/\/[^"\s]+db\.prisma\.io[^"\s]*/)?.[0] ?? "";
if (!url) {
  console.log("URL tidak ditemukan (scripts/.dburl-prisma-blue hilang)");
  process.exit(3);
}

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient({
  datasources: { db: { url } },
  log: [{ emit: "stdout", level: "error" }],
});

const mask = (s) =>
  String(s).replace(/postgres(?:ql)?:\/\/[^@\s]+@/g, "postgres://***@");

let t0 = Date.now();
try {
  const r = await db.$queryRawUnsafe("SELECT 1 AS alive");
  console.log(`HASIL: DB HIDUP & OTENTIKASI OK — SELECT 1 = ${JSON.stringify(r)} (${Date.now() - t0}ms)`);
  // Cek data nyata: jumlah user & pesanan (integritas data pasca-pause)
  try {
    const u = await db.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM "User"');
    const o = await db.$queryRawUnsafe('SELECT COUNT(*)::int AS n FROM "Order"');
    console.log(`DATA: User=${u[0]?.n}, Order=${o[0]?.n} — data utuh`);
  } catch (e2) {
    console.log(`DATA: tabel tak terbaca — ${mask(e2?.message).slice(0, 160)}`);
  }
} catch (e) {
  const msg = mask(e?.message ?? e);
  console.log(`HASIL: GAGAL — kode=${e?.code ?? "(tanpa kode)"} (${Date.now() - t0}ms)`);
  console.log(msg.slice(0, 400));
  console.log("--- klasifikasi ---");
  if (/P1001|Can't reach|ETIMEDOUT|ECONNREFUSED|ECONNRESET|no route|timed out/i.test(msg))
    console.log(">> TIDAK TERJANGKAU — instance kemungkinan PAUSE/mati");
  if (/P1000|authentication|Authentication|role .* does not exist|password/i.test(msg))
    console.log(">> OTENTIKASI DITOLAK — URL/kredensial salah atau expired");
  if (/paus|suspend|deprovision|quota|limit|upgrade/i.test(msg))
    console.log(">> INSTANCE PAUSE / QUOTA — pesan server menyebutkannya langsung");
} finally {
  await db.$disconnect();
}
