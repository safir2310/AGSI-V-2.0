// Hapus user uji UI push (push-ui-check@agsi.test) + data terkait
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const email = "push-ui-check@agsi.test";

async function main() {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.log("User uji tidak ada — sudah bersih.");
    return;
  }
  await db.pushToken.deleteMany({ where: { userId: user.id } });
  await db.biometricCredential.deleteMany({ where: { userId: user.id } });
  await db.session.deleteMany({ where: { userId: user.id } });
  await db.order.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });
  console.log(`✓ User uji dihapus: ${user.id} (${email})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
