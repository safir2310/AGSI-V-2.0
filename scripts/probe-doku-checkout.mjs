/**
 * Probe DOKU Checkout API (non-SNAP legacy) PRODUCTION — transaksi uji Rp1.000.
 *   node scripts/probe-doku-checkout.mjs
 * Rahasia tidak dicetak. Response penuh ditampilkan (mask URL token jika ada).
 */
import { createHash, createHmac } from "node:crypto";

const CLIENT_ID = (process.env.DOKU_CLIENT_ID ?? "").trim();
const SECRET = (process.env.DOKU_CLIENT_SECRET ?? "").trim();
const BASE = "https://api.doku.com";
const WEBHOOK = "https://agsi-v-2-0.vercel.app/api/webhooks/qris";

function isoUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
function legacyHeaders(target, bodyRaw) {
  const requestId = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const ts = isoUtc();
  const digest = createHash("sha256").update(bodyRaw).digest("base64");
  const stringToSign = [
    `Client-Id:${CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${ts}`,
    `Request-Target:${target}`,
    `Digest:${digest}`,
  ].join("\n");
  return {
    "Client-Id": CLIENT_ID,
    "Request-Id": requestId,
    "Request-Timestamp": ts,
    "Request-Target": target,
    Signature: `HMACSHA256=${createHmac("sha256", SECRET).update(stringToSign).digest("base64")}`,
    "Content-Type": "application/json",
  };
}

async function post(target, body) {
  const raw = JSON.stringify(body);
  const res = await fetch(`${BASE}${target}`, {
    method: "POST",
    headers: legacyHeaders(target, raw),
    body: raw,
  });
  const text = await res.text();
  return { httpStatus: res.status, text };
}

async function main() {
  const inv = `PROBE-CHK-${Date.now()}`;
  console.log("=== DOKU CHECKOUT PROBE (produksi) ===");

  const body = {
    order: {
      invoice_number: inv,
      amount: 1000,
      currency: "IDR",
      callback_url: WEBHOOK,
      language: "id",
      additional_info: {},
      line_items: [{ name: "Teh Es (uji)", quantity: 1, price: 1000 }],
    },
    payment: { payment_due_date: 5, enable_saves: false, enable_paylater: false },
    customer: { name: "Uji AGSI", email: "probe@agsi.co.id" },
  };

  const r = await post("/checkout/v1/payment", body);
  console.log(`POST /checkout/v1/payment: HTTP ${r.httpStatus}`);
  console.log(r.text.slice(0, 2000));

  // Jika sukses → langsung cek status via Check Status API
  if (r.httpStatus < 300) {
    try {
      const j = JSON.parse(r.text);
      const url = j?.response?.payment?.url ?? j?.payment?.url;
      console.log(`\npayment.url: ${url ? url.slice(0, 120) : "(tidak ada)"}`);
    } catch {}
    console.log(`\n--- Check Status GET /orders/v1/status/${inv} ---`);
    const target = `/orders/v1/status/${inv}`;
    const requestId = `${Date.now()}99`;
    const ts = isoUtc();
    const stringToSign = [
      `Client-Id:${CLIENT_ID}`,
      `Request-Id:${requestId}`,
      `Request-Timestamp:${ts}`,
      `Request-Target:${target}`,
    ].join("\n");
    const res2 = await fetch(`${BASE}${target}`, {
      headers: {
        "Client-Id": CLIENT_ID,
        "Request-Id": requestId,
        "Request-Timestamp": ts,
        "Request-Target": target,
        Signature: `HMACSHA256=${createHmac("sha256", SECRET).update(stringToSign).digest("base64")}`,
      },
    });
    console.log(`HTTP ${res2.status}`);
    console.log((await res2.text()).slice(0, 1500));
  }
  console.log("=== SELESAI ===");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
