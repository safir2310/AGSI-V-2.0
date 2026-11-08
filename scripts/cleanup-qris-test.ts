// Hapus pesanan uji coba QRIS (dibuat saat pengujian fitur pembayaran) + kembalikan poin member
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const codes = ["AGSI-20261104-9726", "AGSI-20261104-1184", "AGSI-20261104-3677"];
  for (const code of codes) {
    const o = await db.order.findUnique({ where: { code }, include: { items: true } });
    if (o) {
      // kembalikan poin member yang didapat dari pesanan uji
      const pts = Math.floor(o.total / 10000);
      if (o.userId && pts > 0) {
        await db.user.update({ where: { id: o.userId }, data: { points: { decrement: pts } } });
      }
      await db.order.delete({ where: { id: o.id } });
      console.log(`Pesanan uji dihapus: ${code}`);
    } else {
      console.log(`Sudah tidak ada: ${code}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
