/**
 * turso-recon.mjs — koneksi ke Turso (database-pink-kettle): struktur tabel,
 * jumlah baris, dan kesegaran data (tanggal terbaru per tabel penting).
 * Token diambil dari Vercel storage store secrets (TIDAK dicetak).
 * Pemakaian: node scripts/turso-recon.mjs
 */
import { readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const T = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const STORE = "store_zG5O87nasLvQolxH"; // database-pink-kettle (Turso, Starter, available)

const api = async (p) => {
  const r = await fetch(`https://api.vercel.com/v1${p}${p.includes("?") ? "&" : "?"}teamId=${T}`, {
    headers: { Authorization: `Bearer ${VT}` },
  });
  return r.json();
};

// 1) ambil token & URL dari secrets store
const s = await api(`/storage/stores/${STORE}/secrets`);
const flat = {};
for (const [k, v] of Object.entries(s)) {
  if (typeof v === "string" || typeof v === "number") flat[k] = String(v);
  else if (v && typeof v === "object" && "value" in v) flat[k] = String(v.value);
}
const token = flat["data_TURSO_AUTH_TOKEN"] ?? flat["TURSO_AUTH_TOKEN"] ?? "";
const urlSecret = flat["data_TURSO_DATABASE_URL"] ?? flat["TURSO_DATABASE_URL"] ?? "";
const urlOwner = "libsql://database-pink-kettle-vercel-icfg-jgyaeywkuedf7avmnam1bgxs.aws-us-east-1.turso.io";
if (!token) { console.log("TURSO_AUTH_TOKEN tidak ditemukan di store"); process.exit(2); }
writeFileSync("/home/z/my-project/scripts/.turso-token", token);
chmodSync("/home/z/my-project/scripts/.turso-token", 0o600);
console.log(`token tersimpan (len=${token.length})`);
console.log(`URL store: ${urlSecret ? "ada, host=" + urlSecret.split("//")[1] : "(tidak ada di store — pakai URL dari pemilik)"}`);
console.log(`URL pakai: ${urlOwner.split("//")[1]}`);

// 2) koneksi + rekondisi
const { createClient } = await import("@libsql/client");
const db = createClient({ url: urlOwner, authToken: token });
const t0 = Date.now();
const tables = (await db.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table','index') ORDER BY name")).rows;
const tnames = tables.filter((r) => r.type === "table" && !String(r.name).startsWith("sqlite_") && !String(r.name).startsWith("_libsql"));
console.log(`\nKONEKSI OK (${Date.now() - t0}ms) — ${tnames.length} tabel:`);
for (const r of tnames) {
  const n = r.name;
  let cnt = "?", latest = "";
  try {
    const c = await db.execute({ sql: `SELECT COUNT(*) AS n FROM "${n}"`, args: [] });
    cnt = c.rows[0]?.n;
    const cols = (await db.execute({ sql: `PRAGMA table_info("${n}")`, args: [] })).rows.map((x) => x.name);
    const dateCol = cols.find((c) => /createdAt|updatedAt|uploadedAt|paidAt|lastMessageAt|expiresAt/.test(c));
    if (dateCol && Number(cnt) > 0) {
      const l = await db.execute({ sql: `SELECT MAX("${dateCol}") AS m FROM "${n}"`, args: [] });
      latest = ` terbaru=${l.rows[0]?.m ?? "-"}`;
    }
    console.log(`  ${String(n).padEnd(22)} ${String(cnt).padStart(6)} baris (kolom: ${cols.length})${latest}`);
  } catch (e) {
    console.log(`  ${n}: GAGAL — ${String(e.message).slice(0, 100)}`);
  }
}
