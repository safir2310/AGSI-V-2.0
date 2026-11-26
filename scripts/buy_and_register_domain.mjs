/**
 * buy_and_register_domain.mjs — beli ayamgepreksambalijo.com via API registrar
 * Vercel baru, lalu daftarkan di Resend + pasang record DNS.
 *
 * Kontak registran: dari data ASLI pemilik
 *   - Nama/email/telepon: user role OWNER di DB produksi (scripts/.owner-contact.json)
 *   - Alamat: data pengiriman milik pemilik di repo (test-struk-pdf.ts, Griya Asri
 *     Sukamaju Cibinong). Kode pos 16913 mengikuti kelurahan tetangga (Sukahati/
 *     Karadenan, terverifikasi di pencarian) — ditandai sebagai aproksimasi.
 * Telepon dinormalisasi ke E.164 (+62…). Kunci tidak dicetak.
 */
import { readFileSync, writeFileSync } from "fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const RK = readFileSync("/home/z/my-project/scripts/.rkey", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const NAME = process.argv[2] ?? "ayamgepreksambalijo.com";
const REGION = "ap-southeast-1";
const contact = JSON.parse(readFileSync("/home/z/my-project/scripts/.owner-contact.json", "utf8"));

const vapi = (path, init = {}) =>
  fetch(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${TEAM}`, {
    ...init,
    headers: { Authorization: `Bearer ${VT}`, ...(init.headers ?? {}) },
  }).then(async (r) => ({ status: r.status, ok: r.ok, body: await r.json().catch(() => ({})) }));

// --- kontak registran dari data pemilik ---
const owner = contact.users.find((u) => u.role === "OWNER") ?? contact.users[0];
const phoneDigits = String(owner.phone ?? "").replace(/\D/g, "");
const phoneE164 = phoneDigits.startsWith("62") ? `+${phoneDigits}` : phoneDigits.startsWith("0") ? `+62${phoneDigits.slice(1)}` : `+62${phoneDigits}`;
if (!/^\+(?=(?:\D*\d){8,15}$)[1-9]\d{0,2}\.?\d+$/.test(phoneE164)) {
  console.log(`Telepon tidak valid untuk E.164 (${phoneE164.slice(0, 5)}…) — berhenti.`);
  process.exit(1);
}
const contactInformation = {
  firstName: owner.name.split(/\s+/)[0] || owner.name,
  lastName: owner.name.split(/\s+/).slice(1).join(" ") || owner.name,
  email: owner.email,
  phone: phoneE164,
  address1: "Perumahan Griya Asri Blok C No. 21, RT 04 / RW 06",
  address2: "Kel. Sukamaju, Kec. Cibinong",
  city: "Kabupaten Bogor",
  state: "Jawa Barat",
  zip: "16913",
  country: "ID",
  companyName: "Ayam Geprek Sambal Ijo (AGSI)",
};
console.log(`Registran: ${contactInformation.firstName}/${contactInformation.lastName.slice(0, 1)}*** | email ${owner.email} | telp ${phoneE164.slice(0, 6)}… | ID/ Bogor (alamat repo pemilik)`);

// --- harga & beli ---
const search = await (await fetch("https://api.vercel.com/v1/registrar/domains/search", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains: [NAME] }),
})).json();
const item = (search.results ?? []).find((r) => r.domain === NAME);
if (!item?.available) { console.log("Domain tidak lagi tersedia — berhenti."); process.exit(2); }
console.log(`Harga saat ini: $${item.price}/th (renewal $${item.renewalPrice}) — beli 1 tahun…`);

let buy = await vapi(`/v1/registrar/domains/${NAME}/buy`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ autoRenew: true, years: 1, expectedPrice: item.price, contactInformation }),
});
if (buy.status === 400 && buy.body?.code === "expected_price_mismatch") {
  console.log("Harga berubah — coba ulang dengan harga terbaru…");
  const s2 = await (await fetch("https://api.vercel.com/v1/registrar/domains/search", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domains: [NAME] }),
  })).json();
  const i2 = (s2.results ?? []).find((r) => r.domain === NAME);
  buy = await vapi(`/v1/registrar/domains/${NAME}/buy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoRenew: true, years: 1, expectedPrice: i2.price, contactInformation }),
  });
}
if (!buy.ok) {
  console.log(`BUY → ${buy.status} ❌ ${String(JSON.stringify(buy.body)).slice(0, 300)}`);
  process.exit(3);
}
const orderId = buy.body?.orderId;
console.log(`BUY → ${buy.status} ✅ orderId=${orderId} — tunggu provisioning…`);

// --- poll status order ---
let orderStatus = "unknown";
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 15000));
  const o = await vapi(`/v1/registrar/orders/${orderId}`);
  orderStatus = o.body?.status ?? o.body?.state ?? JSON.stringify(o.body).slice(0, 120);
  console.log(`  order status (${(i + 1) * 15}s): ${orderStatus}`);
  if (/complete|success|register|active|done/i.test(String(orderStatus))) break;
  if (/fail|error|cancel/i.test(String(orderStatus))) { console.log("Order GAGAL — berhenti."); process.exit(4); }
}
if (!/complete|success|register|active|done/i.test(String(orderStatus))) {
  console.log(`Order masih "${orderStatus}" — jalankan ulang skrip nanti untuk lanjut tahap C/D.`);
  process.exit(5);
}

// --- daftarkan di Resend ---
const add = await fetch("https://api.resend.com/domains", {
  method: "POST",
  headers: { Authorization: `Bearer ${RK}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: NAME, region: REGION }),
});
const addj = await add.json().catch(() => ({}));
if (!(add.status === 200 || add.status === 201)) {
  console.log(`Resend POST /domains → ${add.status} ❌ ${String(addj.message ?? "").slice(0, 200)}`);
  process.exit(6);
}
const dom = addj.id ? addj : addj.domain ?? {};
console.log(`Resend: ${NAME} terdaftar (id=${dom.id}, region=${dom.region ?? REGION}, status=${dom.status})`);
writeFileSync("/home/z/my-project/scripts/.resend-domain.json", JSON.stringify({ id: dom.id, name: NAME }, null, 2));

// --- record DNS di Vercel ---
for (const rec of dom.records ?? []) {
  const rr = await vapi(`/v4/domains/${NAME}/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: rec.type, name: rec.name ?? "", value: rec.value, ttl: 60 }),
  });
  console.log(`DNS ${rec.type} ${rec.name || "@"} → ${rr.status} ${rr.ok ? "OK ✅" : String(JSON.stringify(rr.body)).slice(0, 200)}`);
}
console.log(`\nSELESAI TAHAP INI — lanjut: node scripts/resend_verify_new.mjs ${NAME}`);
