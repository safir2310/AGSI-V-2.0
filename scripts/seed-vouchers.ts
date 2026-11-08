/**
 * Seed voucher demo untuk AYAM GEPREK SAMBAL IJO.
 * Jalankan: bun run scripts/seed-vouchers.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DEMO_VOUCHERS = [
  {
    code: "GEPREK10",
    title: "Diskon 10% Semua Menu",
    description: "Potongan 10% maksimal Rp 10.000, min. belanja Rp 25.000. Sekali pakai per akun.",
    type: "PERCENT",
    value: 10,
    minPurchase: 25000,
    maxDiscount: 10000,
    quota: 100,
  },
  {
    code: "HEMAT5K",
    title: "Potongan Rp 5.000",
    description: "Potongan langsung Rp 5.000 untuk belanja minimal Rp 20.000. Sekali pakai per akun.",
    type: "FIXED",
    value: 5000,
    minPurchase: 20000,
    maxDiscount: null,
    quota: 100,
  },
  {
    code: "SEKALIPAKAI",
    title: "Voucher Eksklusif Sekali Pakai",
    description: "Potongan Rp 15.000 — kode ini benar-benar hanya bisa dipakai SATU kali oleh satu pelanggan tercepat!",
    type: "FIXED",
    value: 15000,
    minPurchase: 30000,
    maxDiscount: null,
    quota: 1,
  },
];

async function main() {
  for (const v of DEMO_VOUCHERS) {
    const existing = await db.voucher.findUnique({ where: { code: v.code } });
    if (existing) {
      console.log(`↷ voucher ${v.code} sudah ada, lewati`);
      continue;
    }
    await db.voucher.create({ data: v });
    console.log(`+ voucher ${v.code} dibuat`);
  }
  const total = await db.voucher.count();
  console.log(`Selesai. Total voucher: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
