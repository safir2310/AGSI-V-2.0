import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
process.env.DATABASE_URL = fs.readFileSync("/tmp/dburl-neon.txt", "utf8").trim();
const db = new PrismaClient();
try {
  const t = await db.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1;");
  const names = t.map(r => r.table_name);
  console.log("TABEL (%d): %s", names.length, names.join(", ") || "(kosong)");
  for (const n of names) {
    try {
      const c = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${n}";`);
      if (c[0].n > 0) console.log(`  ${n}: ${c[0].n} baris`);
    } catch (e) { console.log(`  ${n}: gagal hitung`); }
  }
} catch (e) {
  console.log("✗ gagal:", e.message.split("\n")[0].slice(0, 120));
} finally { await db.$disconnect(); }
