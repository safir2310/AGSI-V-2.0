/**
 * Bersihkan pesanan uji browser/POS:
 * - AGSI-20261104-4897 (Tes UI voucher oleh budi, GEPREK10)
 * - Pesanan "Tes POS"
 * + sinkronkan ulang usedCount voucher
 * Jalankan: bun run scripts/cleanup-voucher-test.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // Cari pesanan uji (punya redemption GEPREK10 atau bernama "Tes POS")
  const targets = await db.order.findMany({
    where: { OR: [{ customerName: "Tes POS" }, { code: "AGSI-20261104-4897" }] },
    select: { id: true, code: true },
  });
  const ids = targets.map((o) => o.id);
  if (ids.length > 0) {
    await db.voucherRedemption.deleteMany({ where: { orderId: { in: ids } } });
    await db.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await db.order.deleteMany({ where: { id: { in: ids } } });
  }
  console.log(`− ${ids.length} pesanan uji dihapus: ${targets.map((t) => t.code).join(", ") || "-"}`);

  // Sinkronkan usedCount voucher dengan redemption tersisa
  const vouchers = await db.voucher.findMany({ select: { id: true, code: true, usedCount: true } });
  for (const v of vouchers) {
    const real = await db.voucherRedemption.count({ where: { voucherId: v.id } });
    if (v.usedCount !== real) {
      await db.voucher.update({ where: { id: v.id }, data: { usedCount: real } });
      console.log(`↺ ${v.code}: usedCount ${v.usedCount} → ${real}`);
    }
  }
  console.log("Selesai.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
