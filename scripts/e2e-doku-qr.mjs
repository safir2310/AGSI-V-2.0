/**
 * e2e-doku-qr.mjs — uji E2E CHECKOUT GANDA DOKU (QR QRIS asli di kartu QR).
 * Memakai mock DOKU (scripts/doku-mock.mjs :3990) + server lokal :3123 dengan
 * env DOKU_API_BASE/DOKU_CLIENT_ID/DOKU_CLIENT_SECRET menunjuk mock.
 * Asersi:
 *   1. GET /qris → provider doku, qrPage=true, paymentUrl (QRIS-only) + webUrl.
 *   2. Mock menerima 2 checkout: ["QRIS"] (invoice dasar) & tanpa filter (-WEB).
 *   3. Polling: bayar invoice WEB → status PAID (rekonsiliasi invoice kedua).
 *   4. Polling: bayar invoice PRIMARY → PAID (jalur utama).
 *   5. Webhook legacy: notifikasi invoice WEB dgn signature VALID → PAID.
 *   6. Webhook legacy: signature INVALID → 403 (fail-closed tetap).
 */
import { createHash, createHmac } from "crypto";

const BASE = process.argv[2] ?? "http://localhost:3123";
const MOCK = process.argv[3] ?? "http://localhost:3990";
const CLIENT_ID = "doku-e2e-client";
const CLIENT_SECRET = "doku-e2e-secret";
const WEBHOOK_TARGET = "/api/webhooks/qris";

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`); }
};

const jar = new Map();
function storeCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}
async function api(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  storeCookies(res);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
async function mock(path, body) {
  const res = await fetch(MOCK + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const EMAIL = `dokuqr-${Date.now()}@agsi.test`;
console.log(`E2E DOKU-QR vs ${BASE} (mock ${MOCK}) — ${EMAIL}`);

const reg = await api("/api/auth/register", { method: "POST", body: { name: "DOKU QR Tester", email: EMAIL, phone: "081234567892", password: "DokuE2e5x7z" } });
ok("register", reg.status === 200 || reg.status === 201);
const login = await api("/api/auth/login", { method: "POST", body: { email: EMAIL, password: "DokuE2e5x7z" } });
ok("login", login.status === 200);

async function buatPesanan() {
  const o = await api("/api/orders", {
    method: "POST",
    body: { type: "TAKEAWAY", paymentMethod: "QRIS", items: [{ name: "Geprek QR", emoji: "🍗", price: 20000, qty: 1 }] },
  });
  const order = o.json?.order;
  const q = order ? await api(`/api/orders/${order.id}/qris`) : { json: {} };
  return { order, q: q.json };
}

// ==== 1-2) Pesanan A: dual checkout + field UI ====
const A = await buatPesanan();
ok("checkout QRIS dibuat", !!A.order?.id);
ok("provider doku", (A.q.provider ?? "").startsWith("doku"), A.q.provider);
ok("qrPage=true (kartu QR = halaman QRIS asli)", A.q.qrPage === true);
ok("paymentUrl ada (halaman QRIS DOKU)", typeof A.q.paymentUrl === "string" && A.q.paymentUrl.includes("checkout.doku.com"));
ok("webUrl ada (halaman semua metode)", typeof A.q.webUrl === "string" && A.q.webUrl.includes("checkout.doku.com") && A.q.webUrl !== A.q.paymentUrl);
ok("trxId utama tanpa suffix -WEB", typeof A.q.trxId === "string" && !A.q.trxId.endsWith("-WEB"), A.q.trxId);

const st = await mock("/mock/state");
const invs = st.json?.invoices ?? [];
const qrisOnly = invs.find((x) => JSON.stringify(x.channelTypes) === '["QRIS"]');
const noFilter = invs.find((x) => x.channelTypes === null || JSON.stringify(x.channelTypes) === "[]");
ok("mock: checkout kanal ['QRIS'] diterima", !!qrisOnly, qrisOnly?.invoice);
ok("mock: checkout tanpa filter (semua metode) diterima", !!noFilter, noFilter?.invoice);
ok("invoice kedua ber-suffix -WEB", !!noFilter && noFilter.invoice.endsWith("-WEB"));

// ==== 3) Rekonsiliasi: invoice WEB dibayar → PAID ====
await mock("/mock/pay", { invoice: noFilter?.invoice });
const s1 = await api(`/api/orders/${A.order.id}/qris/status`);
ok("bayar invoice WEB → polling → PAID", s1.json?.paymentStatus === "PAID", `paymentStatus=${s1.json?.paymentStatus}`);

// ==== 4) Pesanan B: invoice PRIMARY dibayar → PAID ====
const B = await buatPesanan();
ok("pesanan B: qrPage=true", B.q.qrPage === true);
await mock("/mock/pay", { invoice: B.q.trxId });
const s2 = await api(`/api/orders/${B.order.id}/qris/status`);
ok("bayar invoice PRIMARY → polling → PAID", s2.json?.paymentStatus === "PAID", `paymentStatus=${s2.json?.paymentStatus}`);

// ==== 5) Pesanan C: webhook legacy invoice WEB dgn signature valid → PAID ====
const C = await buatPesanan();
ok("pesanan C: webUrl ada", typeof C.q.webUrl === "string");
const webInvoice = (C.q.webUrl ?? "").split("MOCK-")[1];
// Dana BENAR-BENAR masuk di penyedia sebelum notifikasi datang — webhook
// legacy DOKU di aplikasi selalu KONFIRMASI ULANG status ke DOKU (fail-closed).
await mock("/mock/pay", { invoice: webInvoice });
const body = JSON.stringify({
  order: { invoice_number: webInvoice, amount: 20000, currency: "IDR" },
  transaction: { status: "SUCCESS", date: new Date().toISOString() },
});
const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const reqId = `${Date.now()}99`;
const digest = createHash("sha256").update(body).digest("base64");
const parts = [
  `Client-Id:${CLIENT_ID}`,
  `Request-Id:${reqId}`,
  `Request-Timestamp:${ts}`,
  `Request-Target:${WEBHOOK_TARGET}`,
  `Digest:${digest}`,
];
const sig = `HMACSHA256=${createHmac("sha256", CLIENT_SECRET).update(parts.join("\n")).digest("base64")}`;
const wh = await api("/api/webhooks/qris", {
  method: "POST",
  headers: {
    "Client-Id": CLIENT_ID,
    "Request-Id": reqId,
    "Request-Timestamp": ts,
    "Request-Target": WEBHOOK_TARGET,
    Signature: sig,
  },
  body: JSON.parse(body),
});
ok("webhook invoice WEB (signature valid) diterima", wh.status === 200 && wh.json?.ok === true, `HTTP ${wh.status}`);
const s3 = await api(`/api/orders/${C.order.id}/qris/status`);
ok("webhook invoice WEB → PAID", s3.json?.paymentStatus === "PAID", `paymentStatus=${s3.json?.paymentStatus}`);

// ==== 6) Webhook signature INVALID → 403 (fail-closed) ====
const D = await buatPesanan();
const webD = (D.q.webUrl ?? "").split("MOCK-")[1];
const bodyD = JSON.stringify({
  order: { invoice_number: webD, amount: 20000, currency: "IDR" },
  transaction: { status: "SUCCESS", date: new Date().toISOString() },
});
const wh2 = await api("/api/webhooks/qris", {
  method: "POST",
  headers: {
    "Client-Id": CLIENT_ID,
    "Request-Id": `${Date.now()}98`,
    "Request-Timestamp": ts,
    "Request-Target": WEBHOOK_TARGET,
    Signature: "HMACSHA256=AAAAinvalid==",
  },
  body: JSON.parse(bodyD),
});
ok("webhook signature INVALID → ditolak 403", wh2.status === 403, `HTTP ${wh2.status}`);
const s4 = await api(`/api/orders/${D.order.id}/qris/status`);
ok("pesanan D tetap UNPAID (tanpa webhook sah)", s4.json?.paymentStatus !== "PAID");

console.log(`\nHASIL: pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
