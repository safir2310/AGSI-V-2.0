/**
 * Siapkan data demo kartu member untuk verifikasi browser:
 * - pulihkan sandi akun seed (budi/user123 dst.)
 * - beri budi saldo poin + riwayat EARN agar kartu member terlihat hidup
 */
import { PrismaClient } from "@prisma/client";
import { scryptSync, randomBytes } from "crypto";

const db = new PrismaClient();

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

async function main() {
  await db.user.update({ where: { email: "admin@agsi.test" }, data: { passwordHash: hashPassword("admin123") } });
  await db.user.update({ where: { email: "kasir@agsi.test" }, data: { passwordHash: hashPassword("kasir123") } });
  await db.user.update({ where: { email: "budi@example.com" }, data: { passwordHash: hashPassword("user123") } });

  const budi = await db.user.findUnique({ where: { email: "budi@example.com" } });
  if (budi) {
    await db.pointTransaction.deleteMany({ where: { userId: budi.id } });
    await db.user.update({ where: { id: budi.id }, data: { points: 320 } });
    await db.pointTransaction.create({
      data: {
        userId: budi.id,
        type: "EARN",
        points: 32,
        description: "Point dari pesanan AGSI-20261104-8210",
      },
    });
    await db.pointTransaction.create({
      data: {
        userId: budi.id,
        type: "EARN",
        points: 288,
        description: "Point dari pesanan AGSI-20261028-4417",
      },
    });
  }
  console.log("Demo siap: budi@example.com / user123 — 320 poin");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
