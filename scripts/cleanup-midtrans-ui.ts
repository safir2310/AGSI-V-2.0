/**
 * Bersihkan user test "cek.midtrans@agsi.test" beserta data terkait:
 * pesanan QRIS uji (termasuk transaksi gateway bawaan SBX- terkait) —
 * dipakai untuk verifikasi UI integrasi Midtrans.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const email = "cek.midtrans@agsi.test";

const user = await db.user.findUnique({ where: { email } });
if (!user) {
  console.log("User test tidak ditemukan — tidak ada yang perlu dihapus.");
} else {
  // Simpan kode pesanan utk hapus transaksi sandbox terkait
  const orders = await db.order.findMany({
    where: { userId: user.id },
    select: { id: true, qrisTrxId: true },
  });
  const sbxIds = orders
    .map((o) => o.qrisTrxId)
    .filter((t): t is string => !!t && t.startsWith("SBX-"));

  await db.session.deleteMany({ where: { userId: user.id } });
  await db.pushToken?.deleteMany?.({ where: { userId: user.id } }).catch(() => undefined);
  await db.biometricCredential.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
  await db.order.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });

  let sbxDeleted = 0;
  for (const trxid of sbxIds) {
    const res = await db.qrisSandboxTrx
      .deleteMany({ where: { trxid } })
      .catch(() => ({ count: 0 }));
    sbxDeleted += res.count;
  }
  console.log(
    `User test ${email} dihapus — ${orders.length} pesanan, ${sbxDeleted} trx sandbox gateway dibersihkan.`
  );
}
await db.$disconnect();
