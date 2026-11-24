/**
 * continue_domain_setup.mjs — lanjutan setelah order pembelian dibuat:
 *  1. Poll GET /v1/registrar/orders/{orderId} sampai selesai.
 *  2. Daftarkan domain di Resend (region ap-southeast-1).
 *  3. Pasang record DNS Resend di Vercel DNS.
 * Order ID dibaca dari argumen; kunci tidak dicetak.
 */
import { readFileSync, writeFileSync } from "fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const RK = readFileSync("/home/z/my-project/scripts/.rkey", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const NAME = process.argv[2] ?? "ayamgepreksambalijo.com";
const ORDER_ID = process.argv[3] ?? "01M871P8GM60YM5R7XQ0HNHMV4";
const REGION = "ap-southeast-1";

const vapi = (path, init = {}) =>
  fetch(`https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}teamId=${TEAM}`, {
    ...init,
    headers: { Authorization: `Bearer ${VT}`, ...(init.headers ?? {}) },
  }).then(async (r) => ({ status: r.status, ok: r.ok, body: await r.json().catch(() => ({})) }));

// 1) poll order
let orderStatus = "unknown";
for (let i = 0; i < 16; i++) {
  const o = await vapi(`/v1/registrar/orders/${ORDER_ID}`);
  if (!o.ok) { console.log(`GET order → ${o.status}: ${String(JSON.stringify(o.body)).slice(0, 200)}`); process.exit(1); }
  orderStatus = o.body?.status ?? o.body?.state ?? "?";
  console.log(`order status (${(i + 1) * 15}s): ${orderStatus}`);
  if (/complete|success|register|active|done/i.test(String(orderStatus))) break;
  if (/fail|error|cancel/i.test(String(orderStatus))) { console.log("Order GAGAL — berhenti."); process.exit(2); }
  await new Promise((r) => setTimeout(r, 15000));
}
if (!/complete|success|register|active|done/i.test(String(orderStatus))) {
  console.log(`Order masih "${orderStatus}" — jalankan ulang nanti.`);
  process.exit(3);
}

// 2) daftarkan di Resend
const add = await fetch("https://api.resend.com/domains", {
  method: "POST",
  headers: { Authorization: `Bearer ${RK}`, "Content-Type": "application/json" },
  body: JSON.stringify({ name: NAME, region: REGION }),
});
const addj = await add.json().catch(() => ({}));
if (!(add.status === 200 || add.status === 201)) {
  console.log(`Resend POST /domains → ${add.status} ❌ ${String(addj.message ?? "").slice(0, 200)}`);
  process.exit(4);
}
const dom = addj.id ? addj : addj.domain ?? {};
console.log(`Resend: ${NAME} terdaftar (id=${dom.id}, region=${dom.region ?? REGION}, status=${dom.status})`);
writeFileSync("/home/z/my-project/scripts/.resend-domain.json", JSON.stringify({ id: dom.id, name: NAME }, null, 2));

// 3) record DNS di Vercel
for (const rec of dom.records ?? []) {
  const rr = await vapi(`/v4/domains/${NAME}/records`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: rec.type, name: rec.name ?? "", value: rec.value, ttl: 60 }),
  });
  console.log(`DNS ${rec.type} ${rec.name || "@"} → ${rr.status} ${rr.ok ? "OK ✅" : String(JSON.stringify(rr.body)).slice(0, 200)}`);
}
console.log(`\nLANJUT: node scripts/resend_verify_new.mjs ${NAME}`);
