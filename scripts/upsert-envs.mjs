/**
 * upsert-envs.mjs — ERA SUPABASE: pasang DATABASE_URL (pooler pgbouncer 6543,
 * runtime serverless) + DIRECT_DATABASE_URL (5432, patch DDL saat build) pada
 * project produksi Vercel. TURSO_AUTH_TOKEN dibiarkan utk jalur rollback.
 * Nilai tidak pernah dicetak. Butuh scripts/.vtoken & scripts/.dburl-supabase.
 */
import { readFileSync } from "node:fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const T = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";
const STORE = "store_IF2H52HjA3CcmeNN"; // supabase-apricot-door (ap-southeast-1)

const cfg = Object.fromEntries(
  readFileSync("/home/z/my-project/scripts/.dburl-supabase", "utf8")
    .trim()
    .split("\n")
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const POOLED = cfg.POOLED;
const NONPOOL = cfg.DIRECT;

const api = async (path, method, body) => {
  const r = await fetch(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${T}`, {
    method,
    headers: { Authorization: `Bearer ${VT}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, j };
};

// 0) buku besar: hubungkan store Supabase ke project (jika belum)
{
  const conns = (await api(`/v1/storage/stores/${STORE}/connections`, "GET")).j.connections ?? [];
  if (conns.some((c) => c.projectId === PRJ)) console.log("store: sudah terhubung ke project ✓");
  else {
    const r = await api(`/v1/storage/stores/${STORE}/connections`, "POST", { projectId: PRJ });
    console.log(`store: POST connections → ${r.status} ${r.ok ? "terhubung ✓" : JSON.stringify(r.j).slice(0, 140)}`);
  }
}

// 1) env DATABASE_URL + DIRECT_DATABASE_URL
const list = (await api(`/v10/projects/${PRJ}/env`, "GET")).j.envs ?? [];
const TARGETS = ["production", "preview", "development"];

for (const [key, value] of [
  ["DATABASE_URL", POOLED],
  ["DIRECT_DATABASE_URL", NONPOOL],
]) {
  const cur = list.find((e) => e.key === key);
  if (!cur) {
    const r = await api(`/v10/projects/${PRJ}/env`, "POST", { key, value, type: "encrypted", target: TARGETS });
    console.log(`${key}: POST → ${r.status} ${r.ok ? "dibuat" : JSON.stringify(r.j).slice(0, 120)}`);
  } else {
    const sensitive = cur.type === "sensitive";
    const body = sensitive
      ? { value, target: cur.target?.length ? cur.target : TARGETS }
      : { key, value, type: "encrypted", target: cur.target?.length ? cur.target : TARGETS };
    const r = await api(`/v10/projects/${PRJ}/env/${cur.id}`, "PATCH", body);
    console.log(`${key}: PATCH → ${r.status} ${r.ok ? "diperbarui" : JSON.stringify(r.j).slice(0, 120)}`);
  }
}

// 2) verifikasi mask
const after = (await api(`/v10/projects/${PRJ}/env`, "GET")).j.envs ?? [];
for (const k of ["DATABASE_URL", "DIRECT_DATABASE_URL"]) {
  const e = after.find((x) => x.key === k);
  console.log(`cek ${k}: ada=${!!e} target=${JSON.stringify(e?.target ?? [])}`);
}
