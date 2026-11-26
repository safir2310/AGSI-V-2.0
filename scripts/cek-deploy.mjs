/** cek-deploy.mjs — status 3 deployment produksi terakhir + uji penanda data
 * (UPDATE StoreSetting.updatedAt di Supabase, lalu GET /api/settings produksi
 * harus menunjukkan waktu yang sama → bukti produksi membaca Supabase). */
import { readFileSync } from "node:fs";
import pg from "pg";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const T = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";

const dep = await (await fetch(`https://api.vercel.com/v6/deployments?teamId=${T}&projectId=${PRJ}&limit=3&target=production`, { headers: { Authorization: `Bearer ${VT}` } })).json();
console.log("=== deployment produksi terakhir ===");
for (const d of dep.deployments ?? []) {
  console.log(`  ${d.state.padEnd(7)} ${(d.meta?.githubCommitSha ?? "?").slice(0, 7)} ${new Date(d.createdAt).toISOString().slice(0, 16)}`);
}

// penanda data
const cfg = Object.fromEntries(
  readFileSync("/home/z/my-project/scripts/.dburl-supabase", "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const direct = cfg.DIRECT.replace(/[?&]sslmode=require&?/g, (s) => (s.startsWith("?") ? "?" : "")).replace(/\?$/, "");
const pgc = new pg.Client({ connectionString: direct, ssl: { rejectUnauthorized: false } });
await pgc.connect();
const t0 = new Date();
await pgc.query(`UPDATE "StoreSetting" SET "updatedAt" = $1 WHERE id='main'`, [t0.toISOString()]);
const want = (await pgc.query(`SELECT "updatedAt" FROM "StoreSetting" WHERE id='main'`)).rows[0].updatedAt;
await pgc.end();

// produksi membaca?
const r = await fetch("https://agsi-v-2-0.vercel.app/api/settings");
const j = await r.json().catch(() => ({}));
const got = j?.settings?.updatedAt ?? j?.updatedAt;
console.log(`\npenanda di Supabase : ${new Date(want).toISOString()}`);
console.log(`/api/settings prod  : ${got ? new Date(got).toISOString() : "(field updatedAt tidak terekspose)"}`);
console.log(got ? (Math.abs(new Date(got) - new Date(want)) < 5000 ? "✓ PRODUKSI MEMBACA SUPABASE" : "✗ tidak cocok") : "(verifikasi via endpoint lain — health/menu)");
