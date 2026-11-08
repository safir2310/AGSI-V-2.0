/**
 * Bersihkan data uji integrasi Midtrans QRIS (sesi kredensial baru):
 * - 3 pesanan QRIS uji + transaksi sandbox internal (SBX-)
 * - 1 akun pengguna uji
 * Defensif: tabel/relasi yang tidak ada dilewati tanpa error.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const EMAIL = "uji-midtrans-qris@test.local";

async function main() {
  // 1) Pesanan uji milik user uji
  const user = await db.user.findUnique({ where: { email: EMAIL } });
  if (user) {
    const orders = await db.order.findMany({
      where: { userId: user.id },
      select: { id: true, code: true },
    });
    for (const o of orders) {
      await db.orderItem.deleteMany({ where: { orderId: o.id } });
      await db.pointTransaction.deleteMany({ where: { orderId: o.id } }).catch(() => undefined);
      await db.voucherRedemption.deleteMany({ where: { orderId: o.id } }).catch(() => undefined);
      await db.order.delete({ where: { id: o.id } }).catch(() => undefined);
    }
    console.log(`Pesanan dihapus: ${orders.length}`);

    // 2) Transaksi QRIS sandbox internal terkait (prefix SBX-)
    const sbx = await db.qrisSandboxTrx.findMany({
      where: { trxid: { startsWith: "SBX-" } },
      select: { id: true, trxid: true },
    });
    for (const t of sbx) {
      await db.qrisSandboxTrx.delete({ where: { id: t.id } }).catch(() => undefined);
    }
    console.log(`Transaksi sandbox dihapus: ${sbx.length}`);

    // 3) Akun uji
    await db.chatMessage.deleteMany({ where: { thread: { userId: user.id } } }).catch(() => undefined);
    await db.chatThread.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await db.pushToken.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await db.biometricCredential.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    console.log("Akun uji dihapus: uji-midtrans-qris@test.local");
  } else {
    console.log("Akun uji tidak ditemukan — tidak ada yang perlu dibersihkan.");
  }

  // Sisa transaksi sandbox menganggur (aman dihapus: hanya data uji)
  const orphan = await db.qrisSandboxTrx.deleteMany({});
  console.log(`Sisa transaksi sandbox dihapus: ${orphan.count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
