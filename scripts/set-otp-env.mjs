/**
 * set-otp-env.mjs — pasang env OTP di Vercel:
 *   OTP_SECRET   (dari env OTP_SECRET_VAL — secret acak, belum dipakai kode;
 *                 OTP disimpan sebagai hash scrypt di DB)
 *   RESEND_FROM  (dari env RESEND_FROM_VAL — pemetaan "OTP_FROM" milik pemilik)
 * PATCH-by-id bila var sudah ada, POST bila baru. Nilai tidak dicetak utuh.
 */
import { readFileSync } from "node:fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const T = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";
const h = { Authorization: `Bearer ${VT}`, "Content-Type": "application/json" };
const base = `https://api.vercel.com/v10/projects/${PRJ}/env`;

const mask = (v) => (v.length > 14 ? v.slice(0, 6) + "…" + v.slice(-4) : `${v.slice(0, 2)}…(${v.length})`);

async function upsert(key, value) {
  const list = (await (await fetch(`${base}?teamId=${T}`, { headers: h })).json()).envs ?? [];
  const cur = list.find((e) => e.key === key);
  if (cur) {
    const r = await fetch(`${base}/${cur.id}?teamId=${T}`, {
      method: "PATCH", headers: h,
      body: JSON.stringify({ value, target: cur.target?.length ? cur.target : ["production", "preview", "development"] }),
    });
    console.log(`${key}: PATCH id=${cur.id} → ${r.ok ? "OK" : `GAGAL ${r.status} ${await r.text()}`} (${mask(value)})`);
  } else {
    const r = await fetch(`${base}?teamId=${T}`, {
      method: "POST", headers: h,
      body: JSON.stringify({ key, value, type: "encrypted", target: ["production", "preview", "development"] }),
    });
    console.log(`${key}: POST baru → ${r.ok ? "OK" : `GAGAL ${r.status} ${await r.text()}`} (${mask(value)})`);
  }
}

const secret = process.env.OTP_SECRET_VAL?.trim();
const from = process.env.RESEND_FROM_VAL?.trim();
if (!secret || !from) { console.log("OTP_SECRET_VAL / RESEND_FROM_VAL kosong"); process.exit(2); }
await upsert("OTP_SECRET", secret);
await upsert("RESEND_FROM", from);
