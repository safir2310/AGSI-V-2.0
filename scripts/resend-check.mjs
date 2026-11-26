/**
 * resend-check.mjs — cek konfigurasi email produksi:
 * ambil RESEND_API_KEY + RESEND_FROM dari env Vercel (decrypt), lalu
 * GET https://api.resend.com/domains — tampilkan domain & status verifikasi.
 * API key tidak pernah dicetak utuh.
 */
import { readFileSync } from "node:fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const T = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";

const envs = (await (await fetch(`https://api.vercel.com/v10/projects/${PRJ}/env?decrypt=true&teamId=${T}`, { headers: { Authorization: `Bearer ${VT}` } })).json()).envs ?? [];
const key = envs.find((e) => e.key === "RESEND_API_KEY")?.value ?? "";
const from = envs.find((e) => e.key === "RESEND_FROM")?.value ?? "";
console.log(`RESEND_API_KEY: ${key ? key.slice(0, 7) + "…" + key.slice(-4) + ` (${key.length} char)` : "(KOSONG)"}`);
console.log(`RESEND_FROM   : ${from || "(kosong → fallback onboarding@resend.dev)"}`);

if (key) {
  const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
  const j = await r.json().catch(() => ({}));
  const ds = j.data ?? [];
  console.log(`\nDOMAIN RESEND (${ds.length}):`);
  for (const d of ds) console.log(`  ${d.name} — status=${d.status} region=${d.region ?? "?"}`);
  if (!ds.length) console.log("  (tidak ada domain terdaftar)");
}
