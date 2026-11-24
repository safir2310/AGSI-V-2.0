/**
 * check-env-match.mjs — pastikan env DATABASE_URL project produksi (decrypt)
 * == URL dari store prisma-postgres-blue-pendant yang suspended. Hasil hanya
 * SAMARAN: cocok/tidak + host. Nilai tidak pernah dicetak.
 */
import { readFileSync } from "node:fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const T = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";

const api = async (p) => {
  const r = await fetch(`https://api.vercel.com${p}${p.includes("?") ? "&" : "?"}teamId=${T}`, {
    headers: { Authorization: `Bearer ${VT}` },
  });
  return r.json();
};

// 1) env DATABASE_URL produksi (decrypt)
const envs = await api(`/v9/projects/${PRJ}/env?decrypt=true`);
const list = envs.envs ?? [];
const dbEnv = list.find((e) => e.key === "DATABASE_URL");
if (!dbEnv) { console.log("ENV DATABASE_URL TIDAK ADA"); process.exit(1); }
const envUrl = dbEnv.value ?? "";
// semua target env var lain yang menunjuk postgres (PRISMA_DATABASE_URL/POSTGRES_URL)
const others = list
  .filter((e) => /DATABASE_URL$/.test(e.key) && e.value?.startsWith("postgres"))
  .map((e) => ({ k: e.key, v: e.value }));

// 2) URL dari store suspended
const st = (await api("/storage/stores/store_8juVXcqrtrpKAUlG")).store;
const secs = st.secrets ?? [];
const items = Array.isArray(secs) ? secs : Object.entries(secs).map(([name, value]) => ({ name, value }));
const storeUrl = items.find((x) => /DATABASE_URL/.test(x.name))?.value ?? "";

const host = (u) => u.match(/@([^:/]+):(\d+)\/([^?]*)/)?.slice(1).join(":") ?? "?";
const user = (u) => u.match(/:\/\/([^:]+):/)?.[1] ?? "?";
const eq = (a, b) => a.replace(/^postgresql:/, "postgres:") === b.replace(/^postgresql:/, "postgres:");

console.log(`env DATABASE_URL produksi : postgres://***@${host(envUrl)} (user=${user(envUrl)}, target=${JSON.stringify(dbEnv.target)})`);
for (const o of others) console.log(`env ${o.k.padEnd(20)} : postgres://***@${host(o.v)} ${eq(o.v, envUrl) ? "(SAMA dgn DATABASE_URL)" : "(BERBEDA!)"}`);
console.log(`store blue-pendant        : postgres://***@${host(storeUrl)} (user=${user(storeUrl)})`);
console.log(eq(envUrl, storeUrl)
  ? ">> COCOK: env produksi menunjuk ke instance yang suspended — RESUME langsung menyembuhkan produksi (tanpa deploy)"
  : ">> TIDAK COCOK: env produksi menunjuk URL BERBEDA — perlu dipasangkan ulang setelah resume");
