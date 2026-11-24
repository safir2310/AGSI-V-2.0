/**
 * resend_domain_check.mjs — tentukan domain AKTIF untuk pengiriman email Resend.
 *
 * 1. Ambil RESEND_API_KEY + RESEND_FROM dari env Vercel proyek agsi-v-2-0
 *    (list /env untuk dapat id → GET /env/{id}?decrypt=true untuk plaintext).
 * 2. GET https://api.resend.com/domains → daftar resmi domain + status.
 * 3. Jika kunci send-only (GET ditolak), probe empiris kirim email per domain.
 * Kunci tidak pernah dicetak utuh.
 */
import { readFileSync } from "fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "agsi-v-2-0";
const vh = { Authorization: `Bearer ${VT}` };

const vget = (p) => fetch(`https://api.vercel.com${p}${p.includes("?") ? "&" : "?"}teamId=${TEAM}`, { headers: vh });

// 1) id env → plaintext
const list = (await (await vget(`/v10/projects/${PRJ}/env`)).json()).envs ?? [];
const wanted = {};
for (const k of ["RESEND_API_KEY", "RESEND_FROM"]) {
  const e = list.find((x) => x.key === k && x.target?.includes("production"));
  if (!e) { wanted[k] = ""; continue; }
  const d = await (await vget(`/v10/projects/${PRJ}/env/${e.id}?decrypt=true`)).json();
  wanted[k] = d.value ?? "";
}
console.log(
  "RESEND_API_KEY:", wanted.RESEND_API_KEY ? `ada (${wanted.RESEND_API_KEY.length} char, ${wanted.RESEND_API_KEY.slice(0, 3)}…)` : "(KOSONG)",
  "| RESEND_FROM:", wanted.RESEND_FROM || "(kosong)"
);

const KEY = wanted.RESEND_API_KEY;
if (!KEY) { console.log("Tidak ada kunci — berhenti."); process.exit(1); }
const mask = (s) => `${s.slice(0, 6)}…${s.slice(-4)}`;

// 2) Daftar domain resmi
try {
  const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${KEY}` } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 200 && Array.isArray(j.data)) {
    console.log(`\nGET /domains OK — ${j.data.length} domain terdaftar:`);
    for (const d of j.data) console.log(`- ${d.name}: status=${d.status}, region=${d.region ?? "-"}`);
    process.exit(0);
  }
  console.log(`GET /domains → ${r.status} (${String(j.message ?? "").slice(0, 140)}) — coba probe empiris`);
} catch (e) {
  console.log("GET /domains error jaringan:", String(e).slice(0, 120));
}

// 3) Probe empiris (kunci send-only)
const FROMS = ["no-reply@agsi.co.id", "no-reply@ayamgepreksambalijo.com", "onboarding@resend.dev"];
for (const from of FROMS) {
  try {
    const p = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `AGSI <${from}>`, to: ["diag-probe.agsi@zagent-test.dev"], subject: "Probe status domain", html: "<p>tes</p>" }),
    });
    const pj = await p.json().catch(() => ({}));
    console.log(`${from} → ${p.status}`, p.ok ? "TERKIRIM — domain AKTIF ✅" : `DITOLAK — ${String(pj.message ?? JSON.stringify(pj)).slice(0, 200)}`);
  } catch (e) {
    console.log(`${from} → error jaringan:`, String(e).slice(0, 120));
  }
}
