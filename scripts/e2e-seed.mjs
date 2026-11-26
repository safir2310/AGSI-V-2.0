// e2e-seed.mjs — buat user ADMIN untuk uji E2E (hash format sama dengan
// src/lib/auth.ts: "salt:hash" scrypt 64 byte). Jalankan dgn DATABASE_URL
// menunjuk DB E2E.
import { randomBytes, scryptSync } from "crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const email = "e2e-admin@test.local";
await db.user.upsert({
  where: { email },
  update: { role: "ADMIN", passwordHash: hashPassword("Test1234!") },
  create: { email, name: "E2E Admin", role: "ADMIN", passwordHash: hashPassword("Test1234!") },
});
const u = await db.user.findUnique({ where: { email } });
console.log("seed OK:", u.email, "| role:", u.role, "| id:", u.id);
await db.$disconnect();
