/**
 * set-resend-key.mjs — pasang RESEND_API_KEY (kunci baru dari pemilik) di Vercel.
 * Kunci dibaca dari argumen env RESEND_TEST_KEY; tidak pernah dicetak utuh.
 */
import { readFileSync } from "node:fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const T = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";
const KEY = "RESEND_API_KEY";
const VALUE = process.env.RESEND_TEST_KEY?.trim();
if (!VALUE?.startsWith("re_")) {
  console.log("kunci tidak valid"); process.exit(2);
}

const h = { Authorization: `Bearer ${VT}`, "Content-Type": "application/json" };
const base = `https://api.vercel.com/v10/projects/${PRJ}/env`;

const existing = (await (await fetch(`${base}?teamId=${T}`, { headers: h })).json()).envs ?? [];
const cur = existing.find((e) => e.key === KEY);
const mask = (v) => v.slice(0, 9) + "…" + v.slice(-4);
if (cur) {
  const r = await fetch(`${base}/${KEY}?teamId=${T}`, {
    method: "PATCH", headers: h,
    body: JSON.stringify({ value: VALUE, target: cur.target?.length ? cur.target : ["production", "preview", "development"] }),
  });
  console.log("PATCH", KEY, r.ok ? `OK (nilai lama ${mask(cur.value)} → baru ${mask(VALUE)})` : `GAGAL ${r.status} ${await r.text()}`);
} else {
  const r = await fetch(`${base}?teamId=${T}`, {
    method: "POST", headers: h,
    body: JSON.stringify({ key: KEY, value: VALUE, type: "encrypted", target: ["production", "preview", "development"] }),
  });
  console.log("POST", KEY, r.ok ? `OK (${mask(VALUE)})` : `GAGAL ${r.status} ${await r.text()}`);
}
