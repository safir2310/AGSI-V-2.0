/**
 * Terapkan schema Prisma (DDL SQLite) ke database TURSO.
 * DDL dihasilkan offline: prisma migrate diff --from-empty --to-schema-datamodel
 * Pakai: bun scripts/setup-turso.ts /path/ke/ddl.sql
 */
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error("TURSO_DATABASE_URL tidak ada di .env");
  process.exit(1);
}

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

// Cek koneksi dulu
const ping = await client.execute("SELECT sqlite_version() AS s");
console.log(`Terhubung: sqlite=${ping.rows[0].s} @ ${url.split("//")[1]?.split(".")[0]}`);

// Cek tabel yang sudah ada (jangan jatuhkan tabel kalau DDL sudah diterapkan)
const existing = await client.execute(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '_prisma_%'`,
);
const names = existing.rows.map((r) => String(r.name));
console.log("Tabel ada sebelumnya:", names.length ? names.join(", ") : "(kosong — database baru)");

const ddlPath = process.argv[2] ?? "/tmp/turso-ddl.sql";
const ddl = readFileSync(ddlPath, "utf8");

// Idempoten: bungkus CREATE TABLE dengan IF NOT EXISTS agar aman dijalankan ulang
const idempotent = ddl
  .replace(/CREATE TABLE "?(\w+)"? \(/g, 'CREATE TABLE IF NOT EXISTS "$1" (')
  .replace(/CREATE UNIQUE INDEX "?(\w+)"? ON/g, 'CREATE UNIQUE INDEX IF NOT EXISTS "$1" ON')
  .replace(/CREATE INDEX "?(\w+)"? ON/g, 'CREATE INDEX IF NOT EXISTS "$1" ON');

await client.executeMultiple(idempotent);
console.log(`DDL diterapkan (${ddlPath})`);

const after = await client.execute(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`,
);
const afterNames = after.rows.map((r) => String(r.name));
console.log(`Tabel setelah DDL (${afterNames.length}):`, afterNames.join(", "));

client.close();
