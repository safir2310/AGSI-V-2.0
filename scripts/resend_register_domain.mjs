/**
 * resend_register_domain.mjs — daftarkan domain AGSI di Resend (kunci full-access
 * dari pemilik, dibaca dari scripts/.rkey; TIDAK pernah dicetak).
 *
 * 1. GET /domains  → daftar domain yang sudah ada + status.
 * 2. Jika target belum terdaftar → POST /domains (region arg, fallback us-east-1).
 * 3. Cetak record DNS resmi dari Resend + simpan panduan singkat ke download/.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";

const RK = readFileSync("/home/z/my-project/scripts/.rkey", "utf8").trim();
const H = { Authorization: `Bearer ${RK}`, "Content-Type": "application/json" };
const NAME = process.argv[2] ?? "agsi.co.id";
const REGIONS = [process.argv[3] ?? "ap-southeast-1", "us-east-1"];

// 1) daftar domain saat ini
const g = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${RK}` } });
const gj = await g.json().catch(() => ({}));
if (g.status !== 200) {
  console.log(`GET /domains → ${g.status}: ${String(gj.message ?? "").slice(0, 200)}`);
  process.exit(1);
}
console.log(`GET /domains OK — ${gj.data.length} domain sudah terdaftar:`);
for (const d of gj.data) console.log(`- ${d.name}: status=${d.status}, region=${d.region ?? "-"}`);
const existing = gj.data.find((d) => d.name === NAME);
let domain = existing;

// 2) daftarkan bila belum ada
if (existing) {
  console.log(`\n${NAME} SUDAH terdaftar (id=${existing.id}, status=${existing.status})`);
} else {
  for (const region of REGIONS) {
    const r = await fetch("https://api.resend.com/domains", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ name: NAME, region }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 200 || r.status === 201) {
      domain = j.id ? j : (j.domain ?? {});
      console.log(`\n✅ ${NAME} TERDAFTAR: id=${domain.id}, status=${domain.status}, region=${domain.region ?? region}`);
      break;
    }
    console.log(`POST /domains region=${region} → ${r.status}: ${String(j.message ?? JSON.stringify(j)).slice(0, 200)}`);
  }
}

// 3) record DNS dari API (GET /domains/{id} kalau perlu) → simpan panduan
if (domain?.id) {
  const d = await (await fetch(`https://api.resend.com/domains/${domain.id}`, { headers: { Authorization: `Bearer ${RK}` } })).json().catch(() => ({}));
  const dom = d.id ? d : domain;
  const recs = dom.records ?? [];
  console.log(`\nStatus domain: ${dom.status ?? "?"} — record DNS dari Resend:`);
  for (const rec of recs) {
    console.log(`- ${rec.type} | ${rec.name || "@ (apex)"} | ${String(rec.value).slice(0, 100)}${String(rec.value).length > 100 ? "…" : ""}`);
  }
  mkdirSync("/home/z/my-project/download", { recursive: true });
  const lines = [
    `# Record DNS untuk ${NAME} (Resend, id=${dom.id}, region=${dom.region ?? "-"}, status=${dom.status})`,
    "",
    `Dibuat otomatis: ${new Date().toISOString()} — sumber: API Resend (GET /domains/${dom.id}).`,
    "Tambahkan record berikut di penyedia DNS domain, lalu tunggu status Verified di Resend.",
    "",
    recs.length
      ? recs.map((r) => `| ${r.type} | ${r.name || "@ (apex)"} | \`${r.value}\` |`).join("\n")
      : "(API tidak mengembalikan record — cek dashboard resend.com/domains)",
    "",
    recs.length ? "| Tipe | Host | Nilai |" : "",
  ];
  writeFileSync("/home/z/my-project/download/resend-dns-agsi.co.id.md", lines.filter(Boolean).join("\n") + "\n");
  console.log("\nPanduan disimpan: download/resend-dns-agsi.co.id.md");
}
