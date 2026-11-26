/**
 * resend_domain_add.mjs — daftarkan domain AGSI di Resend via API.
 * Kunci RESEND_API_KEY diambil dari env produksi Vercel (decrypt per-env).
 * Jika kunci send-only → API menolak, skrip mencetak pesan dan berhenti.
 * Kunci tidak pernah dicetak utuh.
 */
import { readFileSync } from "fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "agsi-v-2-0";
const vh = { Authorization: `Bearer ${VT}` };
const vget = (p) => fetch(`https://api.vercel.com${p}${p.includes("?") ? "&" : "?"}teamId=${TEAM}`, { headers: vh });

const list = (await (await vget(`/v10/projects/${PRJ}/env`)).json()).envs ?? [];
const e = list.find((x) => x.key === "RESEND_API_KEY" && x.target?.includes("production"));
const KEY = e ? (await (await vget(`/v10/projects/${PRJ}/env/${e.id}?decrypt=true`)).json()).value ?? "" : "";
if (!KEY) { console.log("RESEND_API_KEY tidak ditemukan di env produksi."); process.exit(1); }

const NAME = process.argv[2] ?? "agsi.co.id";
const REGION = process.argv[3] ?? "us-east-1";

const r = await fetch("https://api.resend.com/domains", {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: NAME, region: REGION }),
});
const j = await r.json().catch(() => ({}));

console.log(`POST /domains (${NAME}, ${REGION}) → HTTP ${r.status}`);
if (r.status === 200 || r.status === 201) {
  const d = j.id ? j : j.domain ?? {};
  console.log(`✅ TERDAFTAR: id=${d.id ?? "?"}, status=${d.status ?? "?"}`);
  const recs = d.records ?? [];
  if (recs.length) {
    console.log("\nRecord DNS yang harus ditambahkan:");
    for (const rec of recs) console.log(`- ${rec.type}\t${rec.name || "@ (apex)"}\t${String(rec.value).slice(0, 120)}`);
  }
} else {
  console.log("❌ DITOLAK:", String(j.message ?? JSON.stringify(j)).slice(0, 240));
  process.exit(1);
}
