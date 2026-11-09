/**
 * Probe DOKU API LEGACY (Non-SNAP) — uji autentikasi Client-Id + Secret Key
 * dengan formula signature lama (HMACSHA256 atas header komponen).
 *
 *   bun scripts/probe-doku-legacy.ts
 *
 * 1. GET /orders/v1/status/<invoice> — Check Status (GET tanpa Digest)
 * 2. Jika auth OK: coba endpoint QRIS legacy kandidat
 */
import { createHash, createHmac } from "crypto";

const CLIENT_ID = (process.env.DOKU_CLIENT_ID ?? "").trim();
const SECRET = (process.env.DOKU_CLIENT_SECRET ?? "").trim();
const BASES = [
  ["PRODUKSI", "https://api.doku.com"],
  ["SANDBOX", "https://api-sandbox.doku.com"],
] as const;

/** Request-Timestamp ISO8601 UTC+0 tanpa milidetik */
function isoUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Signature legacy: "HMACSHA256=" + base64(HMAC-SHA256(secret, komponen \n)) */
function legacySignature(components: string): string {
  const mac = createHmac("sha256", SECRET).update(components).digest("base64");
  return `HMACSHA256=${mac}`;
}

function headersFor(target: string, bodyRaw: string | null) {
  const requestId = `${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
  const ts = isoUtc();
  const parts = [
    `Client-Id:${CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${ts}`,
    `Request-Target:${target}`,
  ];
  if (bodyRaw !== null) {
    const digest = createHash("sha256").update(bodyRaw).digest("base64");
    parts.push(`Digest:${digest}`);
  }
  return {
    "Client-Id": CLIENT_ID,
    "Request-Id": requestId,
    "Request-Timestamp": ts,
    "Request-Target": target,
    Signature: legacySignature(parts.join("\n")),
    ...(bodyRaw !== null ? { "Content-Type": "application/json" } : {}),
  };
}

async function get(base: string, target: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${base}${target}`, {
      method: "GET",
      headers: headersFor(target, null),
      signal: controller.signal,
    });
    const text = await res.text();
    return { httpStatus: res.status, text: text.slice(0, 400) };
  } catch (err) {
    return { httpStatus: 0, text: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function post(base: string, target: string, body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${base}${target}`, {
      method: "POST",
      headers: headersFor(target, raw),
      body: raw,
      signal: controller.signal,
    });
    const text = await res.text();
    return { httpStatus: res.status, text: text.slice(0, 500) };
  } catch (err) {
    return { httpStatus: 0, text: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log("=== PROBE DOKU LEGACY (Non-SNAP) ===");
  console.log(`Client-Id: ${CLIENT_ID}  Secret: ${SECRET.slice(0, 6)}…`);

  for (const [label, base] of BASES) {
    console.log(`\n=== ${label} (${base}) ===`);

    // [1] Check Status — invoice acak (transaksi pasti tidak ada, tapi auth diuji)
    const invoice = `PROBE-LEGACY-${Date.now()}`;
    const target = `/orders/v1/status/${invoice}`;
    const r = await get(base, target);
    console.log(`[1] Check Status GET: HTTP ${r.httpStatus}\n    ${r.text}`);

    // [2] Kandidat endpoint QRIS legacy (hanya bila auth OK — HTTP bukan 401)
    if (r.httpStatus !== 401) {
      const genBody = {
        order: {
          invoice_number: `PROBE-QR-${Date.now()}`,
          amount: 1000,
          currency: "IDR",
          line_items: [{ name: "Probe", price: 1000, quantity: 1 }],
        },
        payment: { payment_due_date: 5 },
      };
      for (const t of ["/qr-code-mpm/v1/generate-qr", "/preference/api/v1/order"]) {
        const p = await post(base, t, genBody);
        console.log(`[2] POST ${t}: HTTP ${p.httpStatus}\n    ${p.text}`);
      }
    }
  }
  console.log("\n=== PROBE LEGACY SELESAI ===");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
