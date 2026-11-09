/**
 * Probe DOKU Checkout dengan curl (header terkirim PERSIS apa adanya —
 * undici/fetch menormalkan ke lowercase dan DOKU menolaknya).
 *   node scripts/probe-doku-checkout2.mjs
 */
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const CLIENT_ID = (process.env.DOKU_CLIENT_ID ?? "").trim();
const SECRET = (process.env.DOKU_CLIENT_SECRET ?? "").trim();
const BASE = "https://api.doku.com";
const WEBHOOK = "https://agsi-v-2-0.vercel.app/api/webhooks/qris";

function isoUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function callViaCurl(method, target, bodyRaw) {
  const requestId = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const ts = isoUtc();
  const parts = [
    `Client-Id:${CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${ts}`,
    `Request-Target:${target}`,
  ];
  if (bodyRaw !== null) {
    parts.push(`Digest:${createHash("sha256").update(bodyRaw).digest("base64")}`);
  }
  const sig = `HMACSHA256=${createHmac("sha256", SECRET).update(parts.join("\n")).digest("base64")}`;
  const args = [
    "-sS", "--max-time", "25",
    "-X", method,
    `${BASE}${target}`,
    "-H", `Client-Id: ${CLIENT_ID}`,
    "-H", `Request-Id: ${requestId}`,
    "-H", `Request-Timestamp: ${ts}`,
    "-H", `Request-Target: ${target}`,
    "-H", `Signature: ${sig}`,
    "-w", "\n__HTTP__%{http_code}",
  ];
  if (bodyRaw !== null) {
    args.push("-H", "Content-Type: application/json", "-d", bodyRaw);
  }
  const out = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  const idx = out.lastIndexOf("__HTTP__");
  return { text: out.slice(0, idx).trim(), httpStatus: out.slice(idx + 8).trim() };
}

function main() {
  const inv = `PROBE-CHK2-${Date.now()}`;
  console.log("=== DOKU CHECKOUT via curl (preservasi case header) ===");
  const body = JSON.stringify({
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
  });

  const r = callViaCurl("POST", "/checkout/v1/payment", body);
  console.log(`HTTP ${r.httpStatus}`);
  console.log(r.text.slice(0, 2500));

  // Check status transaksi yang barusan dibuat
  if (r.httpStatus.startsWith("2")) {
    console.log("\n--- Check Status ---");
    const s = callViaCurl("GET", `/orders/v1/status/${inv}`, null);
    console.log(`HTTP ${s.httpStatus}`);
    console.log(s.text.slice(0, 2000));
  }
  console.log("=== SELESAI ===");
}

main();
