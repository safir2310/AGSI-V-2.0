/**
 * agsi_domain_setup.mjs — siapkan SATU domain aktif untuk AGSI di Vercel.
 *
 * Langkah:
 *  1. Lihat domain yang sudah menempel di proyek agsi-v-2-0.
 *  2. Cek domain milik tim (custom domain, status verified/pending).
 *  3. Tambahkan subdomain vercel.app yang tersedia (kandidat berurutan)
 *     → langsung aktif + HTTPS, otomatis mengarah ke deployment produksi.
 *  4. Tampilkan hasil (token TIDAK pernah dicetak).
 */
import { readFileSync } from "fs";

const token = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PROJECT = "agsi-v-2-0";
const H = { Authorization: `Bearer ${token}` };
const api = (path, init) =>
  fetch(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${TEAM}`, {
    ...init,
    headers: { ...H, ...(init?.headers ?? {}) },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

// 1) Domain yang sudah menempel di proyek
const cur = await api(`/v9/projects/${PROJECT}/domains`);
const curList = (cur.body.domains ?? []).map((d) => `${d.name} [${d.verified ? "verified" : "pending"}${d.redirect ? ` → ${d.redirect}` : ""}]`);
console.log("Domain proyek saat ini:", curList.length ? curList.join(", ") : "(kosong)");

// 2) Domain milik tim (custom)
const team = await api("/v4/domains");
const teamList = (team.body.domains ?? []).map((d) => `${d.name} [${d.verified ? "verified" : "pending"}]`);
console.log("Domain terdaftar di tim:", teamList.length ? teamList.join(", ") : "(tidak ada custom domain)");

// 3) Tambahkan subdomain vercel.app pertama yang tersedia
const CANDIDATES = [
  "agsi.vercel.app",
  "ayamgepreksambalijo.vercel.app",
  "sambalijo.vercel.app",
  "agsi-app.vercel.app",
  "ayamgeprek-sambalijo.vercel.app",
  "agsi-online.vercel.app",
  "agsi-food.vercel.app",
];
let created = null;
for (const name of CANDIDATES) {
  if (curList.some((s) => s.startsWith(name))) {
    console.log(`SKIP ${name} — sudah menempel di proyek`);
    created = name;
    break;
  }
  const r = await api(`/v9/projects/${PROJECT}/domains`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (r.status === 200 || r.status === 201) {
    console.log(`OK ${name} — ditambahkan ke proyek (verified=${r.body.verified ?? "?"})`);
    created = name;
    break;
  }
  console.log(`GAGAL ${name} (${r.status}) — ${(r.body.error?.message ?? JSON.stringify(r.body)).slice(0, 120)}`);
}
console.log(created ? `DOMAIN AKTIF: https://${created}` : "TIDAK ADA kandidat yang berhasil");
