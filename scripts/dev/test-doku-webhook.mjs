/**
 * test-doku-webhook.mjs — uji E2E webhook DOKU legacy AGSI (lokal):
 *
 *   1. Kirim notifikasi SUCCESS dgn signature VALID saat DOKU (mock) masih
 *      PENDING → server wajib MENERIMA notif tapi TIDAK melunaskan
 *      (konfirmasi ulang Check Status — fail-closed).
 *   2. Tandai transaksi SUCCESS di mock → kirim lagi → server melunaskan.
 *   3. Kirim sekali lagi (Request-Id baru) → idempoten, tidak error.
 *   4. Signature SALAH → wajib 403.
 *
 * Pemakaian:
 *   node scripts/dev/test-doku-webhook.mjs <invoice> <base-app> <secret>
 * contoh:
 *   node scripts/dev/test-doku-webhook.mjs DOKU-AGSI-20261128-8565-CCDANA \
 *        http://localhost:3123 test-secret
 * (uji #2 butuh mock hidup: curl -X POST http://localhost:4455/__pay/<invoice>)
 */
import { createHash, createHmac, randomUUID } from "node:crypto";

const invoice = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3123";
const secret = process.argv[4] ?? "test-secret";
if (!invoice) {
  console.error("Pemakaian: node test-doku-webhook.mjs <invoice> [base] [secret]");
  process.exit(1);
}
const target = "/api/webhooks/qris";
const amount = Number(process.env.TEST_AMOUNT ?? 15000);
const body = JSON.stringify({
  order: { invoice_number: invoice, amount, currency: "IDR" },
  transaction: { status: "SUCCESS" },
});

function headers(secretKey) {
  const requestId = randomUUID();
  const ts = new Date().toISOString();
  const digest = createHash("sha256").update(body).digest("base64");
  const parts = [
    `Client-Id:test-client`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${ts}`,
    `Request-Target:${target}`,
    `Digest:${digest}`,
  ];
  const sig = `HMACSHA256=${createHmac("sha256", secretKey).update(parts.join("\n")).digest("base64")}`;
  return {
    "Content-Type": "application/json",
    "Client-Id": "test-client",
    "Request-Id": requestId,
    "Request-Timestamp": ts,
    "Request-Target": target,
    Signature: sig,
  };
}

async function send(label, secretKey = secret) {
  const res = await fetch(`${base}${target}`, {
    method: "POST",
    headers: headers(secretKey),
    body,
  });
  const text = await res.text();
  console.log(`${label}: HTTP ${res.status} → ${text.slice(0, 160)}`);
  return { status: res.status, text };
}

// 1) Valid signature, provider masih PENDING → tidak melunaskan
await send("[1] valid, PENDING");
// 2) Tandai SUCCESS di mock lalu kirim lagi
const pay = await fetch(`http://localhost:4455/__pay/${encodeURIComponent(invoice)}`, { method: "POST" }).catch(() => null);
console.log(`[2a] mock __pay → ${pay ? await pay.text() : "mock tidak hidup (lewati — anggap sudah SUCCESS)"}`);
await send("[2b] valid, SUCCESS");
// 3) Idempotensi
await send("[3] ulang (idempoten)");
// 4) Signature salah
await send("[4] signature SALAH", "rahasia-salah");
