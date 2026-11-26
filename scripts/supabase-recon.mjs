/**
 * supabase-recon.mjs — lihat store storage di akun Vercel, env project, dan
 * kredensial Supabase yang mungkin sudah ada. Tidak mencetak nilai rahasia
 * utuh (mask). Butuh scripts/.vtoken.
 */
import { readFileSync } from "node:fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const T = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";

const api = async (p) => {
  const r = await fetch(`https://api.vercel.com${p}${p.includes("?") ? "&" : "?"}teamId=${T}`, {
    headers: { Authorization: `Bearer ${VT}` },
  });
  if (!r.ok) { console.log(`API ${p} → HTTP ${r.status}`); return null; }
  return r.json();
};

console.log("=== STORAGE STORES ===");
const st = await api("/v1/storage/stores");
if (st?.stores) {
  for (const s of st.stores) {
    console.log(`  ${s.id} | type=${s.type} | ${s.name} | status=${s.status ?? "?"}`);
    const conns = await api(`/v1/storage/stores/${s.id}/connections`);
    for (const c of conns?.connections ?? []) console.log(`    └ terhubung ke project ${c.projectId ?? "?"}`);
  }
}

console.log("\n=== ENV PROJECT (nama & target saja) ===");
const env = await api(`/v10/projects/${PRJ}/env`);
for (const e of env?.envs ?? []) {
  console.log(`  ${e.key} [${(e.target ?? []).join(",")}] type=${e.type}`);
}

console.log("\n=== SECRETS STORE SUPABASE ===");
if (st?.stores) {
  for (const s of st.stores.filter((x) => /supabase/i.test(x.name ?? ""))) {
    console.log(`  [${s.name}] dibuat: ${s.createdAt ?? "?"}`);
    const sec = await api(`/v1/storage/stores/${s.id}/secrets`);
    const flat = {};
    for (const [k, v] of Object.entries(sec ?? {})) {
      if (typeof v === "string" || typeof v === "number") flat[k] = String(v);
      else if (v && typeof v === "object" && "value" in v) flat[k] = String(v.value);
    }
    for (const [k, v] of Object.entries(flat)) {
      const isUrl = /postgres|supabase\.co/.test(v);
      console.log(`  ${k} = ${isUrl ? v.replace(/:[^:@/]+@/, ":***@") : `(${v.length} char, mask)`}`);
    }
    if (!Object.keys(flat).length) console.log("  (tidak ada secret yang terbaca)");
  }
}
