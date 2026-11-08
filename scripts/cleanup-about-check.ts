/**
 * Bersihkan user test "cek.tentang@agsi.test" beserta data terkait
 * (dipakai untuk verifikasi UI Tentang Aplikasi).
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const email = "cek.tentang@agsi.test";

const user = await db.user.findUnique({ where: { email } });
if (!user) {
  console.log("User test tidak ditemukan — tidak ada yang perlu dihapus.");
} else {
  await db.session.deleteMany({ where: { userId: user.id } });
  await db.pushToken?.deleteMany?.({ where: { userId: user.id } }).catch(() => undefined);
  await db.biometricCredential.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
  await db.order.deleteMany({ where: { userId: user.id } });
  await db.user.delete({ where: { id: user.id } });
  console.log(`User test ${email} (+data terkait) berhasil dihapus.`);
}
await db.$disconnect();
