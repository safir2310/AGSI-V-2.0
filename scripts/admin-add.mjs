/**
 * admin-add.mjs — buat/upgrade akun admin di Supabase (DB produksi).
 * Email + password lewat argumen: node scripts/admin-add.mjs <email> <password>
 * Hashing persis seperti src/lib/auth.ts: salt 16B hex + scrypt(64B) → "salt:hash".
 * Upsert: sudah ada → role=ADMIN + password diganti; belum → baris baru.
 * Tidak pernah mencetak password/hash.
 */
import { randomBytes, scryptSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const [emailArg, pwdArg] = process.argv.slice(2);
if (!emailArg || !pwdArg) {
  console.log("Pemakaian: node scripts/admin-add.mjs <email> <password>");
  process.exit(2);
}
const email = emailArg.toLowerCase().trim();

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const cfg = Object.fromEntries(
  readFileSync("/home/z/my-project/scripts/.dburl-supabase", "utf8")
    .trim()
    .split("\n")
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const direct = cfg.DIRECT.replace(/[?&]sslmode=require&?/g, (s) => (s.startsWith("?") ? "?" : "")).replace(/\?$/, "");
const c = new pg.Client({ connectionString: direct, ssl: { rejectUnauthorized: false } });
await c.connect();

const existing = await c.query(`SELECT id, email, role, name FROM "User" WHERE email = $1`, [email]);
const now = new Date().toISOString();
let row;
if (existing.rows.length) {
  row = existing.rows[0];
  await c.query(`UPDATE "User" SET role='ADMIN', "passwordHash"=$1, "updatedAt"=$2 WHERE id=$3`, [
    hashPassword(pwdArg), now, row.id,
  ]);
  console.log(`AKUN SUDAH ADA → di-upgrade: ${row.email} role=${row.role}→ADMIN (id ${row.id})`);
} else {
  const id = randomUUID();
  const name = "Admin AGSI";
  await c.query(
    `INSERT INTO "User" (id, email, "passwordHash", name, role, points, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,'ADMIN',0,$5,$5)`,
    [id, email, hashPassword(pwdArg), name, now]
  );
  console.log(`AKUN BARU dibuat: ${email} role=ADMIN name="${name}" (id ${id})`);
}

const chk = await c.query(`SELECT email, role, name FROM "User" WHERE email=$1`, [email]);
console.log(`verifikasi DB: ${JSON.stringify(chk.rows[0])}`);
await c.end();
