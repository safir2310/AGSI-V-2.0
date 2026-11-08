// Bersihkan data uji coba dari database
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const email = "test-lupa@agsi.test";
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.log("Data uji sudah bersih.");
    return;
  }
  await db.order.deleteMany({ where: { userId: user.id } });
  await db.session.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });
  await db.passwordReset.deleteMany({ where: { email } });
  console.log(`Data uji dihapus: user ${user.id}, email ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
