/** Bersihkan sisa data uji sistem poin member (jalankan sebelum/sesudah uji) */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // User uji sementara
  await db.session.deleteMany({ where: { user: { email: "uji.member@agsi.test" } } });
  await db.pointTransaction.deleteMany({ where: { user: { email: "uji.member@agsi.test" } } });
  await db.user.deleteMany({ where: { email: "uji.member@agsi.test" } });

  // Voucher hasil tukar poin (kode PNT-)
  const pntVouchers = await db.voucher.findMany({
    where: { code: { startsWith: "PNT-" } },
    select: { id: true },
  });
  const pntIds = pntVouchers.map((v) => v.id);
  if (pntIds.length > 0) {
    await db.pointTransaction.deleteMany({ where: { voucherId: { in: pntIds } } });
    await db.voucherRedemption.deleteMany({ where: { voucherId: { in: pntIds } } });
    await db.voucher.deleteMany({ where: { id: { in: pntIds } } });
  }

  // Mutasi poin budi + saldo
  const budi = await db.user.findUnique({ where: { email: "budi@example.com" } });
  if (budi) {
    await db.pointTransaction.deleteMany({ where: { userId: budi.id } });
    await db.user.update({ where: { id: budi.id }, data: { points: 0 } });
  }

  console.log("Bersih ✓");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
