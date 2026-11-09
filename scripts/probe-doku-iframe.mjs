/**
 * Probe: apakah halaman pembayaran DOKU bisa di-embed iframe di aplikasi?
 * 1) Buat checkout DOKU (curl, header preservasi case)
 * 2) GET halaman bayar -> dump header respons (cari X-Frame-Options / CSP)
 * 3) Ikuti redirect terakhir juga
 * Jalankan: set -a; source .env; set +a; node scripts/probe-doku-iframe.mjs
 */
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const CLIENT_ID = (process.env.DOKU_CLIENT_ID ?? "").trim();
const SECRET = (process.env.DOKU_CLIENT_SECRET ?? "").trim();
const BASE = "https://api.doku.com";
const WEBHOOK = "https://agsi-v-2-0.vercel.app/api/webhooks/qris";

const isoUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

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

function curlPage(url, extra = []) {
  const args = [
    "-sS", "--max-time", "25", "-o", "/dev/null", "-D", "-",
    "-A", "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Mobile Safari/537.36",
    "-w", "__REDIR__%{redirect_url}\n__FINAL__%{url_effective}",
  ];
  args.push(...extra, url);
  return execFileSync("curl", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
}

function main() {
  const inv = `PROBE-IFR-${Date.now()}`;
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

  console.log("=== 1) Buat Checkout DOKU ===");
  const r = callViaCurl("POST", "/checkout/v1/payment", body);
  console.log(`HTTP ${r.httpStatus}`);
  let payUrl = null;
  try {
    const j = JSON.parse(r.text);
    payUrl = j?.response?.payment?.url ?? j?.payment?.url ?? null;
  } catch { /* abaikan */ }
  console.log("payment.url =", payUrl);
  if (!payUrl) {
    console.log(r.text.slice(0, 1200));
    return;
  }

  console.log("\n=== 2) Header GET halaman bayar (TANPA follow redirect) ===");
  const h1 = curlPage(payUrl);
  console.log(h1.split("__REDIR__")[0].trim());

  console.log("\n=== 3) Header dengan follow redirect -L ===");
  const h2 = curlPage(payUrl, ["-L"]);
  const headers = h2.split("__REDIR__")[0];
  console.log(headers.trim());
  const finalUrl = h2.split("__FINAL__")[1]?.trim();
  console.log("FINAL URL:", finalUrl);

  // Ringkasan keputusan
  const hay = headers.toLowerCase();
  const xfo = hay.includes("x-frame-options");
  const csp = hay.split(/\r?\n/).filter((l) => l.toLowerCase().startsWith("content-security-policy"));
  console.log("\n=== RINGKASAN ===");
  console.log("X-Frame-Options ada?    ", xfo);
  console.log("CSP ada?                ", csp.length > 0 ? csp.join(" | ") : "tidak");
}

main();
