// Hapus 2 pesanan uji coba (dibuat saat pengujian perbaikan) milik akun demo budi
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const codes = ["AGSI-20261103-3001", "AGSI-20261103-6075"];
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
  await db.passwordReset.deleteMany({});
  console.log("Baris kode reset sisa dibersihkan.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
