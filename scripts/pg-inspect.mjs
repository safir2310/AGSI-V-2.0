// pg-inspect.mjs — baca isi DB via Prisma client (koneksi dari /tmp/dburl.txt).
// Menampilkan tabel yang ada + hitungan baris tabel utama AGSI.
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";

process.env.DATABASE_URL = fs.readFileSync("/tmp/dburl.txt", "utf8").trim();
const db = new PrismaClient();

try {
  const tables = await db.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;`,
  );
  const names = tables.map((t) => t.table_name);
  console.log("TABEL (%d):", names.length, names.join(", ") || "(kosong)");
  if (names.length) {
    for (const n of names) {
      try {
        const c = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${n}";`);
        console.log(`  ${n}: ${c[0].n} baris`);
      } catch (e) {
        console.log(`  ${n}: (gagal hitung: ${e.message.split("\n")[0].slice(0, 60)})`);
      }
    }
  }
} catch (e) {
  console.log("✗ gagal:", e.message.split("\n").slice(0, 3).join(" | "));
} finally {
  await db.$disconnect();
}
