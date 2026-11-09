/**
 * Seed akun staf untuk PENGUJIAN LOKAL (bukan produksi!).
 * Pakai: bun scripts/seed-local-staff.mjs
 *   OWNER   owner@agsi.test / owner123  (Musafir Owner)
 *   ADMIN   admin@agsi.test / admin123  (Admin AGSI)
 *   KASIR   kasir@agsi.test / kasir123  (Kasir Satu)
 */
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function generateMemberCode(existing) {
  for (let i = 0; i < 20; i++) {
    const code = String(Math.floor(10000000 + Math.random() * 90000000));
    if (!existing.has(code)) return code;
  }
  throw new Error("gagal membuat memberCode unik");
}

const db = new PrismaClient();
const ACCOUNTS = [
  { email: "owner@agsi.test", password: "owner123", name: "Musafir Owner", role: "OWNER" },
  { email: "admin@agsi.test", password: "admin123", name: "Admin AGSI", role: "ADMIN" },
  { email: "kasir@agsi.test", password: "kasir123", name: "Kasir Satu", role: "CASHIER" },
];

try {
  const taken = new Set(
    (await db.user.findMany({ select: { memberCode: true } }))
      .map((u) => u.memberCode)
      .filter(Boolean),
  );
  for (const a of ACCOUNTS) {
    const user = await db.user.upsert({
      where: { email: a.email },
      update: { passwordHash: hashPassword(a.password), role: a.role, name: a.name },
      create: {
        email: a.email,
        passwordHash: hashPassword(a.password),
        name: a.name,
        role: a.role,
        phone: "08130000000" + (ACCOUNTS.indexOf(a) + 1),
        memberCode: a.role === "CASHIER" ? null : generateMemberCode(taken),
      },
    });
    console.log(`✓ ${user.role.padEnd(7)} ${user.email} (${user.name})`);
  }
} finally {
  await db.$disconnect();
}
