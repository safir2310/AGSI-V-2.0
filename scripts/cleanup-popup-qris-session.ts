/**
 * Bersihkan seluruh jejak sesi E2E popup QRIS:
 * user uji-popup-qris@test.local + pesanan + transaksi sandbox QRIS.
 * Pakai: bun scripts/cleanup-popup-qris-session.ts
 */
import { PrismaClient } from "@prisma/client";

const EMAIL = process.argv[2] ?? "uji-popup-qris@test.local";
const db = new PrismaClient();

const user = await db.user.findUnique({ where: { email: EMAIL } });
if (!user) {
  console.log("User uji tidak ditemukan — DB sudah bersih.");
} else {
  const orders = await db.order.findMany({
    where: { userId: user.id },
    select: { id: true, code: true },
  });
  console.log(`Menghapus ${orders.length} pesanan:`, orders.map((o) => o.code).join(", ") || "-");

  for (const o of orders) {
    await db.orderItem.deleteMany({ where: { orderId: o.id } }).catch(() => undefined);
    await db.pointTransaction.deleteMany({ where: { orderId: o.id } }).catch(() => undefined);
    await db.voucherRedemption.deleteMany({ where: { orderId: o.id } }).catch(() => undefined);
    await db.order.delete({ where: { id: o.id } }).catch(() => undefined);
  }

  await db.qrisSandboxTrx.deleteMany({}).catch(() => undefined);
  await db.chatThread.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
  await db.pushToken.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
  await db.biometricCredential.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
  await db.session.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
  await db.user.delete({ where: { id: user.id } }).catch(() => undefined);
  console.log("User + data terkait dihapus.");
}

// Verifikasi akhir
const left = await db.user.findUnique({ where: { email: EMAIL } });
const leftoverOrders = left
  ? await db.order.count({ where: { userId: left.id } })
  : 0;
const sbx = await db.qrisSandboxTrx.count();
console.log(`Verifikasi: user=${left ? "MASIH ADA" : "bersih"}, pesanan=${leftoverOrders}, trxSandbox=${sbx}`);

await db.$disconnect();
