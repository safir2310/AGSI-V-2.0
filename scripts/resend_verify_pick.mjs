/**
 * resend_verify_pick.mjs — audit 3 domain di akun Resend:
 * untuk tiap domain → ambil record resmi (GET /domains/{id}) → cek resolusi
 * DNS tiap record via DoH (dns.google) → jika SEMUA record resolve,
 * picu verifikasi (POST /domains/{id}/verify) dan laporkan hasilnya.
 * Kunci dibaca dari scripts/.rkey (tidak pernah dicetak).
 */
import { readFileSync } from "fs";

const RK = readFileSync("/home/z/my-project/scripts/.rkey", "utf8").trim();
const AH = { Authorization: `Bearer ${RK}` };

const doh = async (fqdn, type) => {
  const r = await fetch(`https://dns.google/resolve?name=${fqdn}&type=${type}`, { headers: { accept: "application/dns-json" } });
  return r.json().catch(() => ({}));
};

const recFqdn = (name, domain) => (name && name !== "@" ? `${name}.${domain}` : domain);

const checkRecord = async (rec, domain) => {
  const fqdn = recFqdn(rec.name, domain);
  if (rec.type === "TXT") {
    const j = await doh(fqdn, "TXT");
    const vals = (j.Answer ?? []).filter((a) => a.type === 16).map((a) => String(a.data).replace(/"/g, ""));
    const want = String(rec.value).replace(/"/g, "");
    const hit = vals.some((v) => want.includes(v.slice(0, 40)) || v.includes(want.slice(0, 40)) || v.startsWith("p=MIGf") && want.startsWith("p=MIGf") && v.slice(0, 60) === want.slice(0, 60));
    return `${rec.type} ${fqdn}: ${j.Status === 0 && vals.length ? (hit ? "COCOK ✅" : "ADA tapi beda ⚠️") : "TIDAK ADA ❌ (Status " + j.Status + ")"}`;
  }
  if (rec.type === "CNAME") {
    const j = await doh(fqdn, "A");
    const cname = (j.Answer ?? []).find((a) => a.type === 5)?.data ?? "";
    const ok = cname === rec.value || (j.Answer ?? []).length > 0;
    return `${rec.type} ${fqdn}: ${j.Status === 0 && ok ? `COCOK ✅ (→ ${cname || "resolve"})` : "TIDAK ADA ❌ (Status " + j.Status + ")"}`;
  }
  if (rec.type === "MX") {
    const j = await doh(fqdn, "MX");
    const hit = (j.Answer ?? []).some((a) => String(a.data).includes(rec.value));
    return `${rec.type} ${fqdn}: ${j.Status === 0 && hit ? "COCOK ✅" : "TIDAK ADA ❌ (Status " + j.Status + ")"}`;
  }
  return `${rec.type} ${recFqdn(rec.name, domain)}: (tipe dilewati)`;
};

const list = (await (await fetch("https://api.resend.com/domains", { headers: AH })).json()).data ?? [];
const results = [];
for (const d of list) {
  console.log(`\n=== ${d.name} (id=${d.id}, status=${d.status}, region=${d.region ?? "-"})`);
  const full = (await (await fetch(`https://api.resend.com/domains/${d.id}`, { headers: AH })).json().catch(() => ({})));
  const recs = full.records ?? [];
  if (!recs.length) { console.log("  (tidak ada record)"); continue; }
  let allOk = true;
  for (const rec of recs) {
    const line = await checkRecord(rec, d.name);
    if (line.includes("❌") || line.includes("⚠️")) allOk = false;
    console.log("  " + line);
  }
  // NS domain itu sendiri
  const ns = await doh(d.name, "NS");
  console.log(`  NS ${d.name}: Status=${ns.Status}, ${(ns.Answer ?? []).map((a) => a.data).join(", ") || ns.Comment?.slice(0, 80) || "-"}`);
  results.push({ ...d, allOk });
}

// picu verifikasi untuk domain dengan semua record cocok
for (const d of results.filter((x) => x.allOk && x.status !== "success")) {
  console.log(`\n>>> Semua record ${d.name} cocok — picu verifikasi…`);
  const v = await fetch(`https://api.resend.com/domains/${d.id}/verify`, { method: "POST", headers: AH });
  const vj = await v.json().catch(() => ({}));
  console.log(`POST /verify → ${v.status}: ${v.ok ? `status=${vj.status ?? "?"}` : String(vj.message ?? "").slice(0, 160)}`);
}
const best = results.find((x) => x.allOk);
console.log(best ? `\nKANDIDAT TERBAIK: ${best.name} (semua record DNS hidup)` : "\nTIDAK ADA domain dengan record DNS lengkap — perbaiki DNS dulu di registrar.");
