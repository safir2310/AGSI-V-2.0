/**
 * supabase-setup.mjs — terapkan DDL Prisma (postgres) ke Supabase
 * (supabase-apricot-door, ap-southeast-1). Idempoten: IF NOT EXISTS.
 * Butuh scripts/.dburl-supabase (POOLED/DIRECT). Kredensial tak dicetak.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const cfg = Object.fromEntries(
  readFileSync("/home/z/my-project/scripts/.dburl-supabase", "utf8")
    .trim()
    .split("\n")
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
// sslmode=require di URL memaksa verify-full (pg v8.17+) dan menimpa objek
// ssl — buang dari string, kendalikan lewat objek ssl (sandbox MITM proxy).
const direct = cfg.DIRECT.replace(/[?&]sslmode=require&?/g, (s) => (s.startsWith("?") ? "?" : "")).replace(/\?$/, "");
const client = new pg.Client({ connectionString: direct, ssl: { rejectUnauthorized: false } });
await client.connect();

const before = (await client.query(
  `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'pg_%' AND tablename NOT LIKE '_prisma%'`
)).rows.map((r) => r.tablename);
console.log(`Tabel public SEBELUM: ${before.length ? before.join(", ") : "(kosong — DB baru)"}`);

// DDL dari prisma migrate diff (hasil provider postgresql)
const ddl = readFileSync("/tmp/pg-ddl.sql", "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const stmts = ddl.split(";").map((s) => s.trim()).filter((s) => s.length);
let n = 0;
for (const s of stmts) {
  try { await client.query(s); n++; }
  catch (e) {
    if (/already exists/i.test(String(e.message))) continue;
    console.log(`GAGAL: ${s.slice(0, 70)}… → ${String(e.message).slice(0, 150)}`);
    process.exit(1);
  }
}
console.log(`DDL: ${n} pernyataan dieksekusi ✓`);

const after = (await client.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`)).rows.map((r) => r.tablename).sort();
console.log(`Tabel public SESUDAH (${after.length}): ${after.join(", ")}`);
await client.end();
