/**
 * db_owner_probe.mjs — ambil kontak registran dari DB PRODUKSI aplikasi.
 *
 * 1. Decrypt DATABASE_URL / data_DATABASE_URL dari env Vercel (id → ?decrypt=true).
 * 2. Koneksi pg mentah (ssl) → SELECT user OWNER/ADMIN (nama, email, telp).
 * 3. Alamat unik dari PESANAN milik user tsb (userId cocok) sebagai kandidat
 *    alamat registran.
 * URL DB TIDAK dicetak. Telepon disamarkan di output. Hasil → scripts/.owner-contact.json.
 */
import { readFileSync, writeFileSync } from "fs";
import pg from "pg";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "agsi-v-2-0";
const vget = (p) => fetch(`https://api.vercel.com${p}${p.includes("?") ? "&" : "?"}teamId=${TEAM}`, { headers: { Authorization: `Bearer ${VT}` } });

const maskPhone = (p) => (p ? p.slice(0, 4) + "…" + p.slice(-2) : "-");

const list = (await (await vget(`/v10/projects/${PRJ}/env`)).json()).envs ?? [];
const urls = [];
for (const key of ["data_DATABASE_URL", "DATABASE_URL"]) {
  for (const e of list.filter((x) => x.key === key && x.target?.includes("production"))) {
    const d = await (await vget(`/v10/projects/${PRJ}/env/${e.id}?decrypt=true`)).json();
    if (d.value) urls.push({ key, url: d.value });
  }
}
console.log(`DATABASE_URL kandidat produksi: ${urls.length}`);

let result = null;
for (const { key, url: rawUrl } of urls) {
  const url = rawUrl.replace(/sslmode=[^&]+/g, "sslmode=no-verify");
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000, statement_timeout: 20000 });
  try {
    await client.connect();
    const users = (await client.query(`SELECT id, name, email, phone, role FROM "User" WHERE role IN ('OWNER','ADMIN') ORDER BY role='OWNER' DESC LIMIT 10`)).rows;
    console.log(`[${key}] konek OK — user OWNER/ADMIN: ${users.length}`);
    if (!users.length) { await client.end(); continue; }
    const ids = users.map((u) => u.id);
    const ph = ids.map((_, i) => `$${i + 1}`).join(",");
    const orders = (await client.query(`SELECT DISTINCT ON (address) address, phone, "createdAt" FROM "Order" WHERE "userId" IN (${ph}) AND address IS NOT NULL AND address <> '' ORDER BY address, "createdAt" DESC`, ids)).rows;
    for (const u of users) console.log(`  [${u.role}] ${u.name} | ${u.email} | telp ${maskPhone(u.phone)}`);
    console.log(`  alamat unik dari pesanan pemilik: ${orders.length}`);
    orders.slice(0, 6).forEach((o) => console.log("   •", String(o.address).replace(/\n/g, " | ").slice(0, 160)));
    result = { source: key, users, addresses: orders.map((o) => o.address), orderPhones: orders.map((o) => o.phone).filter(Boolean) };
    await client.end();
    break;
  } catch (e) {
    console.log(`[${key}] gagal: ${String(e.message).slice(0, 140)}`);
    try { await client.end(); } catch {}
  }
}

if (!result) { console.log("TIDAK ADA DB yang bisa dibaca — berhenti."); process.exit(1); }
writeFileSync("/home/z/my-project/scripts/.owner-contact.json", JSON.stringify(result, null, 2));
console.log("\nHasil tersimpan: scripts/.owner-contact.json (internal)");
