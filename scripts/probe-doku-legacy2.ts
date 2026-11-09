/**
 * Probe DOKU legacy (Non-SNAP) PRODUCTION — cari endpoint QRIS/pesanan yang
 * hidup dengan kredensial pemilik (auth legacy tervalidasi via Check Status).
 *
 *   bun scripts/probe-doku-legacy2.ts
 *
 * HTTP 404 "No static resource" = path tidak ada; galat lain (400/401/422/2xx)
 * = path HIDUP (payload/auth kita yang perlu disesuaikan).
 */
import { createHash, createHmac } from "crypto";

const CLIENT_ID = (process.env.DOKU_CLIENT_ID ?? "").trim();
const SECRET = (process.env.DOKU_CLIENT_SECRET ?? "").trim();
const BASE = "https://api.doku.com";
const WEBHOOK = "https://agsi-v-2-0.vercel.app/api/webhooks/qris";

function isoUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
function legacyHeaders(target: string, bodyRaw: string) {
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

async function post(target: string, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${BASE}${target}`, {
      method: "POST",
      headers: legacyHeaders(target, raw),
      body: raw,
      signal: controller.signal,
    });
    return { httpStatus: res.status, text: (await res.text()).slice(0, 600) };
  } catch (err) {
    return { httpStatus: 0, text: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log("=== PROBE DOKU LEGACY PRODUCTION — pencarian endpoint ===");

  const inv = `PROBE-${Date.now()}`;
  const commonOrder = {
    invoice_number: inv,
    amount: 1000,
    currency: "IDR",
    callback_url: WEBHOOK,
    line_items: [{ name: "Probe AGSI", quantity: 1, price: 1000 }],
  };

  // [1] Preference API (pembuatan pesanan legacy klasik)
  const b1 = {
    order: {
      ...commonOrder,
      customer_info: { name: "Probe AGSI", email: "probe@agsi.co.id" },
    },
    payment: { payment_due_date: 5 },
  };
  const r1 = await post("/preference/api/v1/order", b1);
  console.log(`[1] POST /preference/api/v1/order: HTTP ${r1.httpStatus}\n    ${r1.text}\n`);

  // [2] Checkout API (non-SNAP, terdokumentasi aktif)
  const b2 = {
    order: { ...commonOrder, language: "id", additional_info: {} },
    payment: { payment_due_date: 5, enable_saves: false, enable_paylater: false },
    customer: { name: "Probe AGSI", email: "probe@agsi.co.id" },
  };
  const r2 = await post("/checkout/v1/payment", b2);
  console.log(`[2] POST /checkout/v1/payment: HTTP ${r2.httpStatus}\n    ${r2.text}\n`);

  // [3] Kandidat EMVCo/QRIS langsung
  for (const t of ["/emvco/qris/v1/payments", "/qr-code-mpm/v1/generate-qr"]) {
    const r = await post(t, { order: commonOrder, payment: { payment_due_date: 5 } });
    console.log(`[3] POST ${t}: HTTP ${r.httpStatus}\n    ${r.text}\n`);
  }

  console.log("=== SELESAI ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
