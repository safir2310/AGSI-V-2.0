/**
 * supabase-save-secrets.mjs — simpan kredensial koneksi Supabase (store
 * supabase-apricot-door, region ap-southeast-1) ke scripts/.dburl-supabase
 * (PROTECTED: masuk .gitignore). Format baris:
 *   POOLED=postgres://...:6543/postgres?sslmode=require&pgbouncer=true
 *   DIRECT=postgres://...:5432/postgres?sslmode=require
 */
import { readFileSync, writeFileSync, chmodSync } from "node:fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const T = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const STORE = "store_IF2H52HjA3CcmeNN"; // supabase-apricot-door (ap-southeast-1)

const r = await fetch(`https://api.vercel.com/v1/storage/stores/${STORE}/secrets?teamId=${T}`, {
  headers: { Authorization: `Bearer ${VT}` },
});
const j = await r.json();
const flat = {};
for (const [k, v] of Object.entries(j)) {
  if (typeof v === "string" || typeof v === "number") flat[k] = String(v);
  else if (v && typeof v === "object" && "value" in v) flat[k] = String(v.value);
}
const pooled = flat["data_POSTGRES_PRISMA_URL"] ?? flat["data_POSTGRES_URL"];
const direct = flat["data_POSTGRES_URL_NON_POOLING"];
if (!pooled) { console.log("POSTGRES_PRISMA_URL tidak ditemukan:", Object.keys(flat).join(", ")); process.exit(2); }
writeFileSync("/home/z/my-project/scripts/.dburl-supabase", `POOLED=${pooled}\nDIRECT=${direct}\nHOST=${flat["data_POSTGRES_HOST"] ?? ""}\n`);
chmodSync("/home/z/my-project/scripts/.dburl-supabase", 0o600);
console.log("tersimpan ✓ pooled:", pooled.replace(/:[^:@/]+@/, ":***@").slice(0, 60), "…");
console.log("direct:", direct ? direct.replace(/:[^:@/]+@/, ":***@").slice(0, 60) + "…" : "(tidak ada)");
