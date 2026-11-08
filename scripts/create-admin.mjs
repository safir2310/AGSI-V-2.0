/**
 * Buat/promosikan akun ADMIN di database produksi.
 *
 * Pakai (satu perintah):
 *   DATABASE_URL="postgres://..." bun scripts/create-admin.mjs <email> <password> [nama]
 *   — atau jika .env sudah berisi DATABASE_URL:
 *   bun scripts/create-admin.mjs <email> <password> [nama]
 *
 * Akun sudah ada  → password & role di-ADMIN-kan (upsert).
 * Belum ada       → dibuat baru dengan role ADMIN + memberCode 8 digit.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

function dbUrl() {
  const arg = process.argv.find((a) => a.startsWith("postgres"));
  if (arg) return arg;
  const envFile = readFileSync(resolve(import.meta.dirname, "..", ".env"), "utf8");
  const m = envFile.match(/^DATABASE_URL="?([^"\n]+)"?$/m);
  if (m && m[1].trim() && m[1].startsWith("postgres")) return m[1].trim();
  throw new Error("DATABASE_URL tidak ada — kirim lewat argumen/env atau isi .env");
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function generateMemberCode(existingCodes) {
  for (let i = 0; i < 20; i++) {
    const code = String(Math.floor(10000000 + Math.random() * 90000000));
    if (!existingCodes.has(code)) return code;
  }
  throw new Error("gagal membuat memberCode unik");
}

const positional = process.argv.slice(2).filter((a) => !a.startsWith("postgres"));
const [email, password, name = "Admin"] = positional;
if (!email || !password) {
  console.error('pakai: bun scripts/create-admin.mjs <email> <password> [nama]');
  process.exit(1);
}
const normalized = String(email).toLowerCase().trim();

const db = new PrismaClient({ datasources: { db: { url: dbUrl() } } });
try {
  const taken = new Set((await db.user.findMany({ select: { memberCode: true } }))
    .map((u) => u.memberCode).filter(Boolean));
  const user = await db.user.upsert({
    where: { email: normalized },
    update: { passwordHash: hashPassword(String(password)), role: "ADMIN", name: String(name).trim() },
    create: {
      email: normalized,
      passwordHash: hashPassword(String(password)),
      name: String(name).trim(),
      role: "ADMIN",
      memberCode: generateMemberCode(taken),
    },
  });
  const cek = scryptSync(
    String(password),
    user.passwordHash.split(":")[0],
    64,
  ).toString("hex") === user.passwordHash.split(":")[1];
  console.log(`✓ akun admin siap:`);
  console.log(`  email      : ${user.email}`);
  console.log(`  nama       : ${user.name}`);
  console.log(`  role       : ${user.role}`);
  console.log(`  memberCode : ${user.memberCode ?? "-"}`);
  console.log(`  verifikasi password: ${cek ? "OK" : "GAGAL!"}`);
} finally {
  await db.$disconnect();
}
