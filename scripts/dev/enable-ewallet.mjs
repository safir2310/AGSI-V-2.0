/**
 * enable-ewallet.mjs — nyalakan saklar ewalletEnabled di DB produksi.
 * Latar: ewalletEnabled=false adalah sisa konfigurasi TOMBOL LAMA
 * "E-Wallet (halaman DOKU)" yang dulu dipisah dari QRIS. Dengan fitur
 * halaman "Metode Pembayaran" yang eksplisit meminta daftar E-Wallet
 * (DANA/OVO/ShopeePay/LinkAja), saklar ini dinyalakan sesuai permintaan
 * pemilik. DATABASE_URL dari .env (tidak dicetak).
 * Jalankan: node scripts/dev/enable-ewallet.mjs
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const db = new PrismaClient({ log: ["error"] });
const before = await db.storeSetting.findUnique({
  where: { id: "main" },
  select: { ewalletEnabled: true, qrisEnabled: true },
});
console.log("SEBELUM:", JSON.stringify(before));
if (!before?.ewalletEnabled) {
  await db.storeSetting.update({ where: { id: "main" }, data: { ewalletEnabled: true } });
  console.log("SESUDAH: ewalletEnabled = true");
} else {
  console.log("Sudah aktif — tidak ada perubahan.");
}
await db.$disconnect();
