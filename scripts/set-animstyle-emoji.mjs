/**
 * set-animstyle-emoji.mjs — pindahkan gaya animasi spanduk beranda di DB
 * produksi ke MODEL BARU "emoji" (spanduk tampil tanpa animasi + trio
 * 🔥⛵️🎃). Hanya field `animStyle` yang diubah — konfigurasi lain milik
 * admin (teks, font, warna, ukuran, kecepatan, BOOM) dipertahankan.
 * DATABASE_URL dibaca dari .env dan tidak dicetak.
 * Jalankan: node scripts/set-animstyle-emoji.mjs
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

// Muat .env manual (tanpa mencetak isinya).
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const db = new PrismaClient({ log: ["error"] });

const row = await db.storeSetting.findUnique({ where: { id: "main" }, select: { courierAnim: true } });
const before = (row?.courierAnim ?? {});
console.log("SEBELUM:", JSON.stringify({ animStyle: before.animStyle ?? "(kosong)" }));

if (before.animStyle === "emoji") {
  console.log("Sudah 'emoji' — tidak ada perubahan.");
} else {
  const after = { ...before, animStyle: "emoji" };
  await db.storeSetting.update({ where: { id: "main" }, data: { courierAnim: after } });
  console.log("SESUDAH:", JSON.stringify({ animStyle: "emoji" }));
  console.log("Field lain dipertahankan:", Object.keys(before).length, "field.");
}

await db.$disconnect();
