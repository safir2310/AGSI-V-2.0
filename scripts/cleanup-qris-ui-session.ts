/**
 * Bersihkan data uji sesi verifikasi UI pembayaran QRIS:
 * - pesanan uji milik akun uji + relasinya
 * - transaksi sandbox internal (SBX-) yang menganggur
 * - akun pengguna uji
 * Defensif: tabel/relasi yang tidak ada dilewati tanpa error.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const EMAIL = process.argv[2] ?? "uji-qris-ui@test.local";

async function main() {
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
    console.log(`Pesanan dihapus: ${orders.map((o) => o.code).join(", ") || "-"}`);

    const sbx = await db.qrisSandboxTrx.deleteMany({});
    console.log(`Transaksi sandbox dihapus: ${sbx.count}`);

    await db.chatMessage.deleteMany({ where: { thread: { userId: user.id } } }).catch(() => undefined);
    await db.chatThread.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await db.pushToken.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await db.biometricCredential.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    console.log(`Akun uji dihapus: ${EMAIL}`);
  } else {
    console.log("Akun uji tidak ditemukan — tidak ada yang perlu dibersihkan.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
