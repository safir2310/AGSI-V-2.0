/**
 * EKSPOR SEMUA DATA TURSO → JSON (backup sebelum migrasi ke Prisma Postgres)
 *
 * Sumber: TURSO_DATABASE_URL + TURSO_AUTH_TOKEN dari .env
 * Output: db/export-turso.json (tanpa mencetak isi baris ke konsol)
 *
 * Jalankan: bun scripts/export-turso.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@libsql/client";

const ROOT = resolve(import.meta.dirname, "..");

// baca .env manual (hindari ketergantungan loader)
const envText = readFileSync(resolve(ROOT, ".env"), "utf8");
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}=(.*)$`, "m"));
  return m?.[1]?.trim().replace(/^"|"$/g, "") ?? "";
};
const url = get("TURSO_DATABASE_URL");
const authToken = get("TURSO_AUTH_TOKEN");
if (!url) {
  console.error("✗ TURSO_DATABASE_URL kosong di .env");
  process.exit(1);
}
console.log(`Koneksi: ${url.replace(/:[^:@/]+@/, ":***@")}`);

const client = createClient({ url, authToken });

const tablesRes = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '_prisma_migrations' ORDER BY name"
);
const tables = tablesRes.rows.map((r) => r.name);
console.log(`Tabel ditemukan (${tables.length}):`, tables.join(", "));

const dump = {};
let total = 0;
for (const t of tables) {
  const res = await client.execute(`SELECT * FROM "${t}"`);
  dump[t] = res.rows.map((r) => ({ ...r }));
  total += dump[t].length;
  console.log(`  ${t.padEnd(22)} ${String(dump[t].length).padStart(5)} baris`);
}

const out = {
  exportedAt: new Date().toISOString(),
  source: url,
  counts: Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length])),
  data: dump,
};
writeFileSync(resolve(ROOT, "db/export-turso.json"), JSON.stringify(out));
console.log(`\n✓ Total ${total} baris tersimpan ke db/export-turso.json`);
