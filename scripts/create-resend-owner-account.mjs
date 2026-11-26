/**
 * create-resend-owner-account.mjs — buat akun ADMIN ber-email musafir2310@gmail.com
 * (satu-satunya penerima yang diizinkan Resend saat mode testing) agar alur
 * OTP EMAIL bisa dipakai nyata tanpa menunggu verifikasi domain.
 * DB: DATABASE_URL dari .env (harus berisi user owner agar dianggap produksi).
 * Password acak dicetak SEKALI di output.
 */
import { readFileSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// pilih DB produksi: coba kandidat URL postgres — yang berisi user owner dipakai
const CANDIDATES = [".dburl-neon", ".dburl-prisma-blue"].map(
  (f) => readFileSync(`/home/z/my-project/scripts/${f}`, "utf8").trim()
);
const EMAIL = "musafir2310@gmail.com";
const NAME = "Pemilik AGSI";
const ROLE = "ADMIN";

let db = null, owner = null;
for (const url of CANDIDATES) {
  process.env.DATABASE_URL = url;
  const c = new PrismaClient();
  try {
    const u = await c.user.findUnique({ where: { email: "2310musafir@gmail.com" } }).catch(() => null);
    if (u) { db = c; owner = u; console.log(`DB produksi terpilih (host=${new URL(url).hostname}) ✓`); break; }
    console.log(`lewati host=${new URL(url).hostname} — user owner tidak ada`);
    await c.$disconnect();
  } catch (e) {
    console.log(`lewati host=${new URL(url).hostname} — ${e.message?.slice(0, 60)}`);
    await c.$disconnect().catch(() => {});
  }
}
if (!db || !owner) {
  console.log("tidak ada DB kandidat yang memuat user owner — berhenti.");
  process.exit(3);
}
console.log(`DB produksi ✓ (owner ada, role=${owner.role})`);

const ex = await db.user.findUnique({ where: { email: EMAIL } });
if (ex) {
  console.log(`akun ${EMAIL} SUDAH ADA (id=${ex.id}, role=${ex.role}) — tidak dibuat ulang.`);
  await db.$disconnect();
  process.exit(0);
}

// password acak AGSI- + 8 hex (13 char, tanpa deret ≥5, tak mengandung local-part email)
const PASSWORD = "AGSI-" + randomBytes(4).toString("hex");
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(PASSWORD, salt, 64).toString("hex");

const u = await db.user.create({
  data: { email: EMAIL, passwordHash: `${salt}:${hash}`, name: NAME, role: ROLE },
});
console.log("AKUN DIBUAT ✓");
console.log(`  email    : ${u.email}`);
console.log(`  nama     : ${u.name}`);
console.log(`  role     : ${u.role}`);
console.log(`  password : ${PASSWORD}   (ganti setelah login pertama!)`);
console.log(`  id       : ${u.id}`);
await db.$disconnect();
