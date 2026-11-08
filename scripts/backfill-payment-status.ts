/**
 * Backfill satu kali setelah kolom Order.paymentStatus ditambahkan.
 * Aturan data lama:
 *  - Pesanan COMPLETED (sudah selesai) dianggap lunas.
 *  - Pesanan POS dengan CASH (uang diterima kasir saat transaksi) dianggap lunas.
 *  - Pesanan lain dibiarkan UNPAID (memang belum dibayar).
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const r1 = await db.order.updateMany({
    where: { status: "COMPLETED" },
    data: { paymentStatus: "PAID" },
  });
  const r2 = await db.order.updateMany({
    where: { source: "POS", paymentMethod: "CASH" },
    data: { paymentStatus: "PAID" },
  });
  console.log(`Backfill selesai: ${r1.count} pesanan COMPLETED + ${r2.count} pesanan POS tunai → PAID`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
