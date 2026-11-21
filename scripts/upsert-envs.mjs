/**
 * upsert-envs.mjs — pasang DATABASE_URL (libsql:// Turso) + TURSO_AUTH_TOKEN
 * pada project produksi Vercel untuk target production/preview/development.
 * Nilai tidak pernah dicetak. Butuh scripts/.vtoken & scripts/.turso-token.
 */
import { readFileSync } from "node:fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const T = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";
const LIBSQL_URL = "libsql://database-pink-kettle-vercel-icfg-jgyaeywkuedf7avmnam1bgxs.aws-us-east-1.turso.io";
const TOKEN = readFileSync("/home/z/my-project/scripts/.turso-token", "utf8").trim();

const api = async (path, method, body) => {
  const r = await fetch(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${T}`, {
    method,
    headers: { Authorization: `Bearer ${VT}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ok: r.ok, j };
};

// ambil id env saat ini
const list = (await api(`/v10/projects/${PRJ}/env`, "GET")).j.envs ?? [];
const TARGETS = ["production", "preview", "development"];

for (const [key, value] of [
  ["DATABASE_URL", LIBSQL_URL],
  ["TURSO_AUTH_TOKEN", TOKEN],
]) {
  const cur = list.find((e) => e.key === key);
  if (!cur) {
    const r = await api(`/v10/projects/${PRJ}/env`, "POST", { key, value, type: "encrypted", target: TARGETS });
    console.log(`${key}: POST → ${r.status} ${r.ok ? "dibuat" : JSON.stringify(r.j).slice(0, 120)}`);
  } else {
    // env tipe "sensitive" (mis. TURSO_AUTH_TOKEN): PATCH hanya boleh mengubah
    // nilai/target — tanpa key & tanpa type.
    const sensitive = cur.type === "sensitive";
    const body = sensitive
      ? { value, target: cur.target?.length ? cur.target : TARGETS }
      : { key, value, type: "encrypted", target: cur.target?.length ? cur.target : TARGETS };
    const r = await api(`/v10/projects/${PRJ}/env/${cur.id}`, "PATCH", body);
    console.log(`${key}: PATCH → ${r.status} ${r.ok ? "diperbarui" : JSON.stringify(r.j).slice(0, 120)}`);
  }
}

// verifikasi: tampilkan mask singkat
const after = (await api(`/v10/projects/${PRJ}/env?decrypt=true`, "GET")).j.envs ?? [];
for (const k of ["DATABASE_URL", "TURSO_AUTH_TOKEN"]) {
  const e = after.find((x) => x.key === k);
  const v = e?.value ?? "";
  console.log(`cek ${k}: target=${JSON.stringify(e?.target)} mulai-dgn=${v.slice(0, 8)}… len=${v.length}`);
}
