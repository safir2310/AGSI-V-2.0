/** Set ulang sandi akun uji agar diketahui (dipakai verifikasi manual UI). */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

const db = new PrismaClient();

function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

async function main() {
  const targets = [
    { email: "admin@agsi.test", pw: "admin123" },
    { email: "kasir@agsi.test", pw: "kasir123" },
    { email: "budi@example.com", pw: "user123" },
  ];
  for (const t of targets) {
    await db.user.update({ where: { email: t.email }, data: { passwordHash: hashPassword(t.pw) } });
  }
  console.log("Password akun uji dikembalikan ke nilai seed (admin123/kasir123/user123).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
