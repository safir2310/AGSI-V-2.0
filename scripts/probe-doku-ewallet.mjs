/**
 * Probe DOKU Checkout — uji kanal E-WALLET (EMONEY_*) di payment_method_types.
 *   node scripts/probe-doku-ewallet.mjs
 *
 * Uji:
 *  1) Filter e-wallet penuh  : EMONEY_DANA/OVO/SHOPEE_PAY/LINKAJA/DOKU
 *  2) Baseline tanpa filter  : apa yang aktif default
 *  3) QRIS                   : kanal "QRIS" eksplisit (untuk info)
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

function callViaCurl(method, target, payload) {
  const bodyRaw = payload === null ? null : JSON.stringify(payload);
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

function orderPayload(inv, methodTypes) {
  return {
    order: {
      invoice_number: inv,
      amount: 2000,
      currency: "IDR",
      callback_url: WEBHOOK,
      language: "id",
      additional_info: {},
      line_items: [{ name: "Teh Es (uji e-wallet)", quantity: 1, price: 2000 }],
    },
    payment: {
      payment_due_date: 5,
      enable_saves: false,
      enable_paylater: false,
      ...(methodTypes ? { payment_method_types: methodTypes } : {}),
    },
    customer: { name: "Uji AGSI", email: "probe@agsi.co.id" },
  };
}

function report(tag, r) {
  console.log(`\n=== ${tag} → HTTP ${r.httpStatus} ===`);
  try {
    const j = JSON.parse(r.text);
    if (j.response?.payment?.payment_method_types) {
      console.log("payment_method_types:", JSON.stringify(j.response.payment.payment_method_types));
    }
    if (j.response?.payment?.url) {
      console.log("url:", j.response.payment.url);
    }
    const err = j.error ?? j.message ?? (j.response_message ? { response_message: j.response_message } : null);
    if (err && !j.response?.payment?.url) console.log("body:", r.text.slice(0, 400));
  } catch {
    console.log(r.text.slice(0, 400));
  }
}

const EWALLET = ["EMONEY_DANA", "EMONEY_OVO", "EMONEY_SHOPEE_PAY", "EMONEY_LINKAJA", "EMONEY_DOKU"];
const stamp = Date.now().toString(36);

report("0a) Kontrol VA_BRI (kanal pasti aktif)", callViaCurl("POST", "/checkout/v1/payment", orderPayload(`PROBE-CTL-${stamp}A`, ["VIRTUAL_ACCOUNT_BRI"])));
report("0b) Kontrol ALFA (retail aktif)", callViaCurl("POST", "/checkout/v1/payment", orderPayload(`PROBE-CTL-${stamp}B`, ["ONLINE_TO_OFFLINE_ALFA"])));
report("0c) Kontrol VA_BRI + EMONEY_DOKU", callViaCurl("POST", "/checkout/v1/payment", orderPayload(`PROBE-CTL-${stamp}C`, ["VIRTUAL_ACCOUNT_BRI", "EMONEY_DOKU"])));
report("1) Filter e-wallet lengkap", callViaCurl("POST", "/checkout/v1/payment", orderPayload(`PROBE-EW-${stamp}A`, EWALLET)));
report("2) Filter DOKU Wallet saja", callViaCurl("POST", "/checkout/v1/payment", orderPayload(`PROBE-EW-${stamp}B`, ["EMONEY_DOKU"])));
report("3) Baseline tanpa filter", callViaCurl("POST", "/checkout/v1/payment", orderPayload(`PROBE-EW-${stamp}C`, null)));
console.log("\n=== SELESAI ===");
