/**
 * test-adapter.mjs — tes runtime PrismaClient + adapter libSQL langsung ke
 * Turso: SELECT 1, hitung tabel inti, dan tulis-baca kecil (transaksi dihapus
 * lagi) untuk memastikan adapter benar-benar bekerja.
 */
import { readFileSync } from "node:fs";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "libsql://database-pink-kettle-vercel-icfg-jgyaeywkuedf7avmnam1bgxs.aws-us-east-1.turso.io";
process.env.TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || readFileSync("/home/z/my-project/scripts/.turso-token", "utf8").trim();

const { PrismaClient } = await import("@prisma/client");
const { PrismaLibSQL } = await import("@prisma/adapter-libsql");

const db = new PrismaClient({
  adapter: new PrismaLibSQL({
    url: process.env.DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
});

const t0 = Date.now();
try {
  const n = await db.product.count();
  const u = await db.user.count();
  const o = await db.order.count();
  console.log(`ADAPTER OK (${Date.now() - t0}ms) — Product=${n}, User=${u}, Order=${o}`);
  const p = await db.product.findMany({ take: 3, select: { name: true, price: true } });
  console.log(`sampel menu: ${p.map((x) => `${x.name}(Rp${x.price})`).join(", ")}`);
  const s = await db.storeSetting.findUnique({ where: { id: "main" } });
  console.log(`StoreSetting main: deliveryEnabled=${s?.deliveryEnabled}, qrisEnabled=${s?.qrisEnabled}, menuPromoBanners=${s?.menuPromoBanners === null ? "null" : typeof s?.menuPromoBanners}`);
  // tulis-baca-hapus uji (tabel dedicated, tak menyentuh data asli)
  await db.biometricChallenge.deleteMany({ where: { key: "uji-adapter:tes" } }).catch(() => {});
  await db.biometricChallenge.create({ data: { key: "uji-adapter:tes", challenge: "abc", expiresAt: new Date(Date.now() + 60000) } });
  const c = await db.biometricChallenge.count({ where: { key: "uji-adapter:tes" } });
  await db.biometricChallenge.deleteMany({ where: { key: "uji-adapter:tes" } });
  console.log(`tulis-baca-hapus uji: ${c === 1 ? "OK ✓" : "GAGAL ✗"}`);
} catch (e) {
  console.log(`GAGAL: ${String(e?.message ?? e).slice(0, 400)}`);
  process.exit(1);
} finally {
  await db.$disconnect();
}
