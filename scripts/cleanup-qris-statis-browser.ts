/** Bersihkan jejak uji browser sesi QRIS statis (pesanan + redemption) */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const CODES = ["AGSI-20261108-2538"]; // pesanan uji via browser
const orders = await db.order.findMany({ where: { code: { in: CODES } }, select: { id: true, code: true } });
for (const o of orders) {
  await db.voucherRedemption.deleteMany({ where: { orderId: o.id } });
  await db.order.delete({ where: { id: o.id } });
  console.log("deleted:", o.code);
}
if (orders.length === 0) console.log("tidak ada jejak uji browser");

const left = await db.order.count({ where: { code: { in: CODES } } });
console.log("sisa:", left);
await db.$disconnect();
