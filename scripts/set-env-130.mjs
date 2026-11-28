/**
 * set-env-130.mjs — persiapan env utk OTP email polos (versi 1.3.30):
 *  1) verifikasi kunci Resend dari pemilik (scripts/.rkey) via API Resend
 *  2) hapus env WHATSAPP_* dari project Vercel (OTP WhatsApp dihapus)
 *  3) pasang RESEND_API_KEY (kunci pemilik), RESEND_FROM, OTP_SECRET (acak —
 *     catatan dokumen: belum dipakai kode, disiapkan utk masa depan)
 * Nilai env TIDAK dicetak; hanya nama & status.
 */
import { readFileSync } from "fs";
import { randomBytes } from "crypto";

const VT = readFileSync("scripts/.vtoken", "utf8").trim();
const RK = readFileSync("scripts/.rkey", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PROJ = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";
const H = { Authorization: `Bearer ${VT}`, "Content-Type": "application/json" };
const base = `https://api.vercel.com`;

const api = async (path, opts) => {
  const res = await fetch(`${base}${path}`, opts);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
};

const listEnv = async () =>
  (await api(`/v9/projects/${PROJ}/env?teamId=${TEAM}`)).json.envs ?? [];

const main = async () => {
  // 1) Verifikasi kunci Resend pemilik
  const r = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${RK}` },
  });
  const rj = await r.json().catch(() => ({}));
  console.log("Resend key check:", r.status, r.ok ? "VALID" : "INVALID");
  if (Array.isArray(rj.data)) console.log("  domains:", rj.data.map((d) => `${d.name}(${d.status})`).join(", ") || "(kosong)");
  if (!r.ok) {
    console.log("  >> kunci tidak valid — RESEND_API_KEY lama TIDAK diganti.");
    return;
  }

  // 2) Daftar env sebelum + hapus WHATSAPP_*
  const before = await listEnv();
  console.log("Env sebelum:", before.map((e) => e.key).join(", "));
  for (const e of before.filter((e) => e.key.startsWith("WHATSAPP_"))) {
    const d = await api(`/v9/projects/${PROJ}/env/${e.id}?teamId=${TEAM}`, { method: "DELETE", headers: { Authorization: `Bearer ${VT}` } });
    console.log(`  hapus ${e.key}:`, d.status);
  }

  // 3) Pasang / perbarui env OTP email (upsert)
  const body = [
    { key: "RESEND_API_KEY", value: RK, type: "encrypted", target: ["production", "preview", "development"] },
    { key: "RESEND_FROM", value: "AGSI <onboarding@resend.dev>", type: "encrypted", target: ["production", "preview", "development"] },
    { key: "OTP_SECRET", value: randomBytes(32).toString("hex"), type: "encrypted", target: ["production", "preview", "development"] },
  ];
  const up = await api(`/v10/projects/${PROJ}/env?teamId=${TEAM}&upsert=true`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(body),
  });
  console.log("Upsert RESEND_API_KEY/RESEND_FROM/OTP_SECRET:", up.status, up.ok ? "OK" : JSON.stringify(up.json).slice(0, 300));

  // 4) Daftar env sesudah
  const after = await listEnv();
  console.log("Env sesudah:", after.map((e) => e.key).join(", "));
};

main();
