/**
 * HITUNG BARIS PER TABEL di database aktif (DATABASE_URL) — cek kosong/isi.
 * Jalankan: bun scripts/count-db.mjs
 */
import { PrismaClient } from "@prisma/client";

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
