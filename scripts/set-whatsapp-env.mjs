/**
 * set-whatsapp-env.mjs — pasang env WhatsApp Cloud API di Vercel:
 *   WHATSAPP_ACCESS_TOKEN        (dari env WHATSAPP_ACCESS_TOKEN_VAL)
 *   WHATSAPP_PHONE_NUMBER_ID     (dari env WHATSAPP_PHONE_NUMBER_ID_VAL)
 *   WHATSAPP_BUSINESS_ACCOUNT_ID (dari env WHATSAPP_BUSINESS_ACCOUNT_ID_VAL)
 *   WHATSAPP_VERIFY_TOKEN        (dari env WHATSAPP_VERIFY_TOKEN_VAL)
 * PATCH-by-id bila var sudah ada, POST bila baru. Nilai TIDAK dicetak utuh.
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

const pairs = [
  ["WHATSAPP_ACCESS_TOKEN", process.env.WHATSAPP_ACCESS_TOKEN_VAL],
  ["WHATSAPP_PHONE_NUMBER_ID", process.env.WHATSAPP_PHONE_NUMBER_ID_VAL],
  ["WHATSAPP_BUSINESS_ACCOUNT_ID", process.env.WHATSAPP_BUSINESS_ACCOUNT_ID_VAL],
  ["WHATSAPP_VERIFY_TOKEN", process.env.WHATSAPP_VERIFY_TOKEN_VAL],
];
for (const [key, val] of pairs) {
  const v = (val ?? "").trim();
  if (!v) { console.log(`${key}: nilai kosong — LEWATI`); continue; }
  await upsert(key, v);
}
