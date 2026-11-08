// Hapus user uji E2E OTP lupa-password (EMAIL env), dari database
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const email = process.env.EMAIL ?? "";

async function main() {
  if (!email) throw new Error("EMAIL env wajib diisi");
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.log("User uji tidak ada — sudah bersih.");
    return;
  }
  await db.pushToken.deleteMany({ where: { userId: user.id } });
  await db.biometricCredential.deleteMany({ where: { userId: user.id } });
  await db.passwordReset.deleteMany({ where: { email } });
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
