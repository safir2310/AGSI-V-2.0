/**
 * set-fallback-email.mjs — pasang RESEND_FALLBACK_TO di Vercel (email pemilik
 * akun Resend, dari env RESEND_FALLBACK_VAL saat menjalankan).
 */
import { readFileSync } from "node:fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const T = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";
const h = { Authorization: `Bearer ${VT}`, "Content-Type": "application/json" };
const base = `https://api.vercel.com/v10/projects/${PRJ}/env`;

const key = "RESEND_FALLBACK_TO";
const value = (process.env.RESEND_FALLBACK_VAL ?? "").trim();
if (!value) { console.log("RESEND_FALLBACK_VAL kosong"); process.exit(2); }

const list = (await (await fetch(`${base}?teamId=${T}`, { headers: h })).json()).envs ?? [];
const cur = list.find((e) => e.key === key);
if (cur) {
  const r = await fetch(`${base}/${cur.id}?teamId=${T}`, {
    method: "PATCH", headers: h,
    body: JSON.stringify({ value, target: cur.target?.length ? cur.target : ["production", "preview", "development"] }),
  });
  console.log(`${key}: PATCH → ${r.ok ? "OK" : `GAGAL ${r.status} ${await r.text()}`}`);
} else {
  const r = await fetch(`${base}?teamId=${T}`, {
    method: "POST", headers: h,
    body: JSON.stringify({ key, value, type: "encrypted", target: ["production", "preview", "development"] }),
  });
  console.log(`${key}: POST baru → ${r.ok ? "OK" : `GAGAL ${r.status} ${await r.text()}`}`);
}
