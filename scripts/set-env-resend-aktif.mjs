/**
 * set-env-resend-aktif.mjs — ganti kunci Resend ke akun AKTIF (kunci baru
 * pemilik di scripts/.rkey):
 *  1) verifikasi kunci baru via GET /domains (cetak domain & status)
 *  2) deteksi email pemilik akun AKTIF: probe kirim via resend.dev — mode
 *     testing menolak penerima lain & menyebut email pemilik di pesan error
 *  3) upsert env Vercel: RESEND_API_KEY (kunci baru), RESEND_FROM = "AGSI
 *     <onboarding@resend.dev>" (nilai OTP_FROM milik pemilik), OTP_SECRET
 *     acak baru, dan RESEND_FALLBACK_TO → inbox akun AKTIF bila berbeda
 *     (fallback staff wajib ke inbox yang diizinkan mode testing akun tsb)
 * Nilai kunci/secret tidak dicetak.
 */
import { readFileSync } from "fs";
import { randomBytes } from "crypto";

const RK = readFileSync("scripts/.rkey", "utf8").trim();
const VT = readFileSync("scripts/.vtoken", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PROJ = "prj_Cm4GS5HjWjgA1bAo2Q3COSiyhgxK";

const main = async () => {
  // 1) verifikasi kunci baru LANGSUNG lewat pengiriman — kunci bisa saja
  //    send-only (GET /domains memang ditolak utk kunci terbatas kirim):
  //    - 200 → kunci valid & bisa kirim bebas
  //    - 403 testing-mode (pesan menyebut email pemilik) → kunci valid
  //    - 401 invalid/not found → kunci benar-benar rusak → batal
  let ownerEmail = null;
  const p = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RK}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "AGSI <onboarding@resend.dev>",
      to: ["diag-probe.agsi@zagent-test.dev"],
      subject: "Probe verifikasi kunci aktif",
      html: "<p>tes</p>",
    }),
  });
  const pj = await p.json().catch(() => ({}));
  const detail = JSON.stringify(pj);
  const m = detail.match(/own email address \(([^)]+)\)/);
  ownerEmail = m ? m[1] : null;
  console.log("Kunci baru (uji kirim):", p.status, p.ok ? "VALID — kirim bebas" : ownerEmail ? `VALID — mode testing, inbox pemilik akun aktif: ${ownerEmail}` : "TAK DIPASTIKAN");
  if (!p.ok) console.log("  detail:", detail.slice(0, 300));
  if (!p.ok && !ownerEmail) {
    console.log(">> kunci baru tak bisa dipakai mengirim — env TIDAK diubah.");
    return;
  }

  // 3) upsert env
  const envs = [
    { key: "RESEND_API_KEY", value: RK, type: "encrypted", target: ["production", "preview", "development"] },
    { key: "RESEND_FROM", value: "AGSI <onboarding@resend.dev>", type: "encrypted", target: ["production", "preview", "development"] },
    { key: "OTP_SECRET", value: randomBytes(32).toString("hex"), type: "encrypted", target: ["production", "preview", "development"] },
  ];
  if (ownerEmail) {
    envs.push({ key: "RESEND_FALLBACK_TO", value: ownerEmail, type: "encrypted", target: ["production", "preview", "development"] });
  }
  const up = await fetch(`https://api.vercel.com/v10/projects/${PROJ}/env?teamId=${TEAM}&upsert=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${VT}`, "Content-Type": "application/json" },
    body: JSON.stringify(envs),
  });
  const uj = await up.json().catch(() => ({}));
  console.log("Upsert env (RESEND_API_KEY/RESEND_FROM/OTP_SECRET" + (ownerEmail ? "/RESEND_FALLBACK_TO" : "") + "):", up.status, up.ok ? "OK" : JSON.stringify(uj).slice(0, 250));
  if (ownerEmail) console.log("RESEND_FALLBACK_TO diarahkan ke inbox akun aktif:", ownerEmail);

  // 4) picu deploy production dari GitHub main (env baru ikut ter-bake)
  const d = await fetch(`https://api.vercel.com/v13/deployments?teamId=${TEAM}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${VT}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: PROJ,
      gitSource: { type: "github", org: "safir2310", repo: "AGSI-V-2.0", ref: "main" },
      target: "production",
    }),
  });
  const dj = await d.json().catch(() => ({}));
  console.log("Trigger deploy:", d.status, d.ok ? `OK id=${dj.id} sha=${(dj.meta?.githubCommitSha ?? "").slice(0, 7)}` : JSON.stringify(dj).slice(0, 300));
};

main();
