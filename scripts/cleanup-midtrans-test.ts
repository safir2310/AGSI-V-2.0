export {}; // modul agar tsc tenang
/** Bersihkan data uji Midtrans: user uji + seluruh pesanannya + trx sandbox. */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const email = "uji.midtrans@agsi.test";

const user = await db.user.findUnique({ where: { email } });
if (!user) {
  console.log("User uji tidak ditemukan.");
} else {
  const orders = await db.order.findMany({ where: { userId: user.id }, select: { id: true } });
  await db.order.deleteMany({ where: { userId: user.id } });
  await db.session.deleteMany({ where: { userId: user.id } });
  await db.biometricCredential.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
  await db.user.delete({ where: { id: user.id } });
  console.log(`Dihapus: user ${email} + ${orders.length} pesanan.`);
}

// Transaksi sandbox tersisa dari pengujian charge
const trx = await db.qrisSandboxTrx.deleteMany({
  where: { reference: { startsWith: "AGSI-20261107" } },
});
console.log(`Transaksi sandbox dihapus: ${trx.count}.`);
await db.$disconnect();
