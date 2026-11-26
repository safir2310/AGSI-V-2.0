/**
 * supabase-migrate-data.mjs — salin SEMUA data dari Turso (libSQL, DB produksi
 * berjalan) ke Supabase Postgres. Id id asli dipertahankan; bolean 0/1 →
 * true/false; jsonb dari teks JSON; urutan insert aman-FK; idempoten
 * (TRUNCATE dulu, ON CONFLICT DO NOTHING).
 * Pemakaian: node scripts/supabase-migrate-data.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { createClient } from "@libsql/client";

const cfg = Object.fromEntries(
  readFileSync("/home/z/my-project/scripts/.dburl-supabase", "utf8")
    .trim()
    .split("\n")
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const tursoToken = readFileSync("/home/z/my-project/scripts/.turso-token", "utf8").trim();
const turso = createClient({
  url: "libsql://database-pink-kettle-vercel-icfg-jgyaeywkuedf7avmnam1bgxs.aws-us-east-1.turso.io",
  authToken: tursoToken,
});
const direct = cfg.DIRECT.replace(/[?&]sslmode=require&?/g, (s) => (s.startsWith("?") ? "?" : "")).replace(/\?$/, "");
const pgc = new pg.Client({ connectionString: direct, ssl: { rejectUnauthorized: false } });
await pgc.connect();

// metadata kolom per tabel di PG
const meta = {};
{
  const r = await pgc.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position`
  );
  for (const row of r.rows) {
    (meta[row.table_name] ??= { cols: [], bool: new Set(), json: new Set(), pk: [] });
    meta[row.table_name].cols.push(row.column_name);
    if (row.data_type === "boolean") meta[row.table_name].bool.add(row.column_name);
    if (row.data_type === "jsonb") meta[row.table_name].json.add(row.column_name);
  }
  const pk = await pgc.query(
    `SELECT tc.table_name, c.column_name FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage cc ON tc.constraint_name=cc.constraint_name AND tc.table_schema=cc.table_schema
     JOIN information_schema.columns c ON c.table_name=cc.table_name AND c.column_name=cc.column_name AND c.table_schema=cc.table_schema
     WHERE tc.table_schema='public' AND tc.constraint_type='PRIMARY KEY'`
  );
  for (const row of pk.rows) meta[row.table_name]?.pk.push(row.column_name);
}

const ORDER = [
  "User", "Product", "Session", "PushToken", "PasswordReset", "ChatThread",
  "ChatMessage", "Voucher", "CourierSetoran", "Order", "OrderItem",
  "DeliveryPhoto", "VoucherRedemption", "PointTransaction", "BiometricCredential",
  "BiometricChallenge", "StoreSetting", "QrisSandboxTrx",
];

// 1) bersihkan target (idempoten utk re-run)
await pgc.query(`TRUNCATE TABLE ${ORDER.map((t) => `"${t}"`).join(", ")} CASCADE`);

let totalSrc = 0, totalDst = 0;
const report = [];
for (const t of ORDER) {
  const src = await turso.execute(`SELECT * FROM "${t}"`);
  const m = meta[t];
  if (!m) { report.push(`${t}: TIDAK ADA DI TARGET ✗`); continue; }
  let inserted = 0;
  for (const row of src.rows) {
    const cols = [], vals = [], ph = [];
    let i = 1;
    for (const c of m.cols) {
      let v = row[c] ?? null;
      if (v !== null && m.bool.has(c)) v = v === 1 || v === true || v === "1";
      if (v !== null && m.json.has(c) && typeof v === "string") { try { v = JSON.parse(v); } catch { /* biarkan string */ } }
      cols.push(`"${c}"`); vals.push(v); ph.push(`$${i++}`);
    }
    if (!cols.length) continue;
    const pkCols = m.pk.length ? m.pk : ["id"];
    const sql = `INSERT INTO "${t}" (${cols.join(", ")}) VALUES (${ph.join(", ")}) ON CONFLICT (${pkCols.map((c) => `"${c}"`).join(",")}) DO NOTHING`;
    const r2 = await pgc.query(sql, vals);
    inserted += r2.rowCount ?? 0;
  }
  // verifikasi jumlah
  const dst = (await pgc.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n;
  totalSrc += src.rows.length; totalDst += dst;
  const ok = dst === src.rows.length ? "✓" : "✗ SELISIH";
  report.push(`${t.padEnd(20)} sumber=${String(src.rows.length).padStart(4)}  target=${String(dst).padStart(4)}  ${ok}`);
  void inserted;
}

console.log("=== HASIL MIGRASI DATA Turso → Supabase ===");
for (const l of report) console.log("  " + l);
console.log(`TOTAL: sumber=${totalSrc}, target=${totalDst} → ${totalSrc === totalDst ? "SAMA ✓" : "BEDA ✗"}`);

// sampel kesegaran
const l = (await pgc.query(`SELECT MAX("createdAt") AS m, COUNT(*)::int AS n FROM "Order"`)).rows[0];
console.log(`Order terbaru di Supabase: ${l.m} (${l.n} baris)`);
await pgc.end();
