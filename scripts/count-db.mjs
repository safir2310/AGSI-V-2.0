/**
 * HITUNG BARIS PER TABEL di database aktif (DATABASE_URL) — cek kosong/isi.
 * Jalankan: bun scripts/count-db.mjs
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Shell sandbox kadang mengekspor DATABASE_URL lama (file:…) — .env menang.
const m = readFileSync(resolve(process.cwd(), ".env"), "utf8").match(/^DATABASE_URL="?(.*?)"?$/m);
if (m?.[1]) process.env.DATABASE_URL = m[1];

const db = new PrismaClient({ log: ["error"] });
const models = [
  "user", "pushToken", "chatThread", "chatMessage", "session", "passwordReset",
  "product", "order", "orderItem", "voucher", "voucherRedemption",
  "pointTransaction", "biometricCredential", "biometricChallenge",
  "storeSetting", "qrisSandboxTrx",
];
for (const m of models) {
  try {
    const n = await db[m].count();
    console.log(`  ${m.padEnd(22)} ${String(n).padStart(5)} baris`);
  } catch (e) {
    console.log(`  ${m.padEnd(22)} ERROR: ${e.message.slice(0, 100)}`);
  }
}
await db.$disconnect();
