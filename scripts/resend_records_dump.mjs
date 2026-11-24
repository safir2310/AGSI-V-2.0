/**
 * resend_records_dump.mjs — dump record DNS resmi Resend untuk SEMUA domain
 * di akun (GET /domains → GET /domains/{id}) → simpan panduan lengkap ke
 * download/resend-dns-guide.md. Kunci dibaca dari scripts/.rkey (tidak dicetak).
 */
import { readFileSync, writeFileSync } from "fs";

const RK = readFileSync("/home/z/my-project/scripts/.rkey", "utf8").trim();
const AH = { Authorization: `Bearer ${RK}` };

const list = (await (await fetch("https://api.resend.com/domains", { headers: AH })).json()).data ?? [];
const out = [
  "# Panduan DNS — Domain Resend AGSI",
  "",
  `Sumber: API Resend, ${new Date().toISOString()}. Akun memiliki ${list.length} domain, semua status "failed" (record DNS belum hidup).`,
  "",
];
for (const d of list) {
  const full = (await (await fetch(`https://api.resend.com/domains/${d.id}`, { headers: AH })).json().catch(() => ({})));
  const recs = full.records ?? [];
  out.push(`## ${d.name}`, "", `id: ${d.id} — status: ${d.status} — region: ${d.region ?? "-"}`, "");
  if (!recs.length) { out.push("(tidak ada record)", ""); continue; }
  out.push("| Tipe | Host (relatif ke domain) | Nilai |", "|---|---|---|");
  for (const r of recs) {
    const val = String(r.value).replace(/\|/g, "\\|");
    out.push(`| ${r.type} | ${r.name || "@ (apex)"} | \`${val}\` |`);
  }
  out.push("");
}
out.push(
  "## Diagnosis",
  "",
  "- `agsi.co.id` — nameserver di registrar MATI (SERVFAIL semua tipe query). Perbaiki NS dulu, lalu tambahkan record di atas.",
  "- `ayamagsi.co.id` — domain TIDAK terdaftar di registry (NXDOMAIN). Beli/daftarkan dulu sebelum bisa diverifikasi.",
  "- `mail.agsi.id` — zona `agsi.id` perlu dicek: bila agsi.id aktif, cukup tambahkan record mail.agsi.id di zona tersebut.",
  "",
  "## Setelah record hidup",
  "",
  "1. Jalankan `node scripts/resend_verify_pick.mjs` (picu POST /domains/{id}/verify).",
  "2. Bila status menjadi `success`: ubah env Vercel `RESEND_FROM` menjadi `AGSI <no-reply@<domain-terverifikasi>>` lalu redeploy.",
  "3. Uji OTP ke alamat pelanggan (bukan hanya inbox pemilik).",
  ""
);
writeFileSync("/home/z/my-project/download/resend-dns-guide.md", out.join("\n"));
console.log("Panduan lengkap disimpan: download/resend-dns-guide.md");
for (const d of list) console.log(`- ${d.name}: ${d.status}`);
