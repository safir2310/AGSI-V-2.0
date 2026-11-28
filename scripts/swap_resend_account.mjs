/**
 * swap_resend_account.mjs — ganti akun Resend yang dipakai aplikasi produksi.
 *
 * 1. Uji kunci baru (scripts/.rkey): GET /domains (scope) + probe kirim dari
 *    onboarding@resend.dev (pesan 403 mengungkap email pemilik akun baru).
 * 2. Jika kunci valid → PATCH RESEND_API_KEY di env Vercel (upsert, semua target)
 *    ke kunci baru. Kunci TIDAK pernah dicetak utuh.
 * 3. Lanjutan (redeploy) dilakukan terpisah.
 */
import { readFileSync, writeFileSync } from "fs";

const RK = readFileSync("/home/z/my-project/scripts/.rkey", "utf8").trim();
const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "agsi-v-2-0";

const mask = (s) => `${s.slice(0, 6)}…${s.slice(-4)}`;
console.log(`Kunci baru: ${mask(RK)} (${RK.length} char)`);

// 1a) scope kunci
let scope = "?";
const g = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${RK}` } });
const gj = await g.json().catch(() => ({}));
if (g.status === 200) {
  scope = "FULL ACCESS (bisa GET/POST domain)";
  console.log(`GET /domains → 200 — ${scope}; domain terdaftar: ${(gj.data ?? []).map((d) => `${d.name}[${d.status}]`).join(", ") || "(kosong)"}`);
} else if (g.status === 401) {
  scope = "send-only";
  console.log(`GET /domains → 401 — ${scope}: ${String(gj.message ?? "").slice(0, 140)}`);
} else {
  console.log(`GET /domains → ${g.status} — ${String(gj.message ?? JSON.stringify(gj)).slice(0, 160)}`);
}

// 1b) probe kirim → validitas + email pemilik akun
const p = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${RK}`, "Content-Type": "application/json" },
  body: JSON.stringify({ from: "AGSI <onboarding@resend.dev>", to: ["diag-probe.agsi@zagent-test.dev"], subject: "probe", html: "<p>tes</p>" }),
});
const pj = await p.json().catch(() => ({}));
let ownerEmail = null;
const m = String(pj.message ?? "").match(/own email address \(([^)]+)\)/);
if (m) ownerEmail = m[1];
if (p.status === 200) {
  console.log("Probe kirim → 200 — akun baru bisa kirim bebas (domain verified di akun ini) ✅");
} else {
  console.log(`Probe kirim → ${p.status} — ${String(pj.message ?? "").slice(0, 200)}`);
  if (ownerEmail) console.log(`Email pemilik akun baru: ${ownerEmail}`);
}
if (g.status !== 200 && p.status !== 200 && !ownerEmail) {
  console.log("Kunci tampak tidak valid — PRODUKSI TIDAK DIUBAH. Periksa kembali kuncinya.");
  process.exit(1);
}

// 2) ganti RESEND_API_KEY di Vercel
const vapi = (path, init = {}) =>
  fetch(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${TEAM}`, {
    ...init,
    headers: { Authorization: `Bearer ${VT}`, ...(init.headers ?? {}) },
  }).then(async (r) => ({ status: r.status, ok: r.ok, body: await r.json().catch(() => ({})) }));

const envs = (await vapi(`/v10/projects/${PRJ}/env`)).body.envs ?? [];
const entries = envs.filter((e) => e.key === "RESEND_API_KEY");
console.log(`Entry RESEND_API_KEY di Vercel: ${entries.length}`);
for (const e of entries) {
  const r = await vapi(`/v10/projects/${PRJ}/env/${e.id}?upsert=true`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "RESEND_API_KEY", value: RK, type: "encrypted", target: e.target ?? ["production", "preview", "development"] }),
  });
  console.log(`  PATCH (${e.target?.join(",")}) → ${r.status} ${r.ok ? "OK ✅" : String(JSON.stringify(r.body)).slice(0, 160)}`);
}
if (!entries.length) {
  const r = await vapi(`/v10/projects/${PRJ}/env?upsert=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "RESEND_API_KEY", value: RK, type: "encrypted", target: ["production", "preview", "development"] }),
  });
  console.log(`  POST (baru) → ${r.status} ${r.ok ? "OK ✅" : String(JSON.stringify(r.body)).slice(0, 160)}`);
}
console.log("\nRESEND_API_KEY produksi sudah menunjuk akun baru. Lanjut: redeploy + health check.");
console.log(`INFO AKUN BARU: scope=${scope}${ownerEmail ? ` | pemilik=${ownerEmail}` : ""} — disimpan ke scripts/.resend-account.json`);
writeFileSync("/home/z/my-project/scripts/.resend-account.json", JSON.stringify({ scope, ownerEmail, at: new Date().toISOString() }, null, 2));
