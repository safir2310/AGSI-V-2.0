/**
 * Probe DOKU — uji tiap kanal e-wallet dipasangkan VA_BRI (kanal aktif).
 * Kanal aktif  -> HTTP 200, types memuat kanal tsb.
 * Kanal mati   -> HTTP 400 "PLEASE USE ANOTHER PAYMENT METHOD".
 *   node scripts/probe-doku-ewallet2.cjs
 */
const { createHash, createHmac } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const CLIENT_ID = (process.env.DOKU_CLIENT_ID || "").trim();
const SECRET = (process.env.DOKU_CLIENT_SECRET || "").trim();

function isoUtc() { return new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); }

function callCheckout(payload) {
  const target = "/checkout/v1/payment";
  const bodyRaw = JSON.stringify(payload);
  const requestId = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const ts = isoUtc();
  const parts = [
    `Client-Id:${CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${ts}`,
    `Request-Target:${target}`,
    `Digest:${createHash("sha256").update(bodyRaw).digest("base64")}`,
  ];
  const sig = `HMACSHA256=${createHmac("sha256", SECRET).update(parts.join("\n")).digest("base64")}`;
  const args = [
    "-sS", "--max-time", "25", "-X", "POST", "https://api.doku.com" + target,
    "-H", `Client-Id: ${CLIENT_ID}`,
    "-H", `Request-Id: ${requestId}`,
    "-H", `Request-Timestamp: ${ts}`,
    "-H", `Request-Target: ${target}`,
    "-H", `Signature: ${sig}`,
    "-H", "Content-Type: application/json",
    "-d", bodyRaw,
    "-w", "\n__HTTP__%{http_code}",
  ];
  const out = execFileSync("curl", args, { encoding: "utf8" });
  const i = out.lastIndexOf("__HTTP__");
  return { text: out.slice(0, i).trim(), status: out.slice(i + 8).trim() };
}

function payload(inv, types) {
  return {
    order: {
      invoice_number: inv, amount: 2000, currency: "IDR",
      callback_url: "https://agsi-v-2-0.vercel.app/api/webhooks/qris",
      language: "id", additional_info: {},
      line_items: [{ name: "Uji", quantity: 1, price: 2000 }],
    },
    payment: {
      payment_due_date: 5, enable_saves: false, enable_paylater: false,
      payment_method_types: types,
    },
    customer: { name: "Uji", email: "probe@agsi.co.id" },
  };
}

const s = Date.now().toString(36);
const channels = ["EMONEY_DANA", "EMONEY_OVO", "EMONEY_SHOPEE_PAY", "EMONEY_LINKAJA", "EMONEY_DOKU"];
for (const ch of channels) {
  const r = callCheckout(payload(`PROBE-D-${s}-${ch.slice(8)}`, [ch, "VIRTUAL_ACCOUNT_BRI"]));
  let line;
  try {
    const j = JSON.parse(r.text);
    line = j.response?.payment
      ? "AKTIF: " + JSON.stringify(j.response.payment.payment_method_types)
      : "DITOLAK: " + JSON.stringify(j.message || j.error);
  } catch { line = r.text.slice(0, 150); }
  console.log(`${ch.padEnd(22)} + VA_BRI -> HTTP ${r.status} :: ${line}`);
}
