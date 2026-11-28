/**
 * doku-mock.mjs — mock kecil DOKU API untuk UJI E2E LOKAL fitur
 * "Metode Pembayaran" AGSI (tanpa kredensial asli).
 *
 * Yang DILAKUKAN (bukan sekadar balas JSON):
 *  - VERIFIKASI SIGNATURE legacy persis rumus DOKU yang dipakai aplikasi
 *    (HMACSHA256= base64(hmac-sha256(secret, "Client-Id:..\\nRequest-Id:..\\n
 *    Request-Timestamp:..\\nRequest-Target:..[\\nDigest:<base64(sha256(body))>])))
 *    → request dari server AGSI yang signature-nya salah DITOLAK 401.
 *  - POST /checkout/v1/payment                      → halaman bayar + va_number
 *  - POST /alfa-online-to-offline/v2/payment-code   → kode bayar Alfamart asli-style
 *  - GET  /orders/v1/status/<invoice>               → status transaksi (PENDING/SUCCESS)
 *
 * Kontrol uji (TANPA signature):
 *  - POST /__pay/<invoice>  → transaksi dinyatakan LUNAS (dana masuk)
 *  - POST /__reset          → hapus semua state
 *
 * Jalankan: node scripts/dev/doku-mock.mjs   (port 4455)
 * Kredensial yang harus dipakai server AGSI: DOKU_CLIENT_ID=test-client,
 * DOKU_CLIENT_SECRET=test-secret, DOKU_API_BASE=http://localhost:4455
 */
import { createHash, createHmac } from "node:crypto";
import http from "node:http";

const SECRET = process.env.MOCK_DOKU_SECRET || "test-secret";
const PORT = Number(process.env.MOCK_DOKU_PORT || 4455);
const state = new Map(); // invoice -> status string

function verifySignature(req, rawBody, url) {
  const got = String(req.headers["signature"] ?? "").trim();
  const clientId = String(req.headers["client-id"] ?? "");
  const requestId = String(req.headers["request-id"] ?? "");
  const ts = String(req.headers["request-timestamp"] ?? "");
  const target = String(req.headers["request-target"] ?? url);
  if (!got || !clientId || !requestId || !ts) return false;
  const parts = [
    `Client-Id:${clientId}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${ts}`,
    `Request-Target:${target.startsWith("/") ? target : `/${target}`}`,
  ];
  if (rawBody.length > 0) {
    parts.push(`Digest:${createHash("sha256").update(rawBody).digest("base64")}`);
  }
  const expected = `HMACSHA256=${createHmac("sha256", SECRET).update(parts.join("\n")).digest("base64")}`;
  return expected.length === got.length && expected === got;
}

function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = req.url || "/";

    // ==== Kontrol uji (tanpa signature) ====
    if (url.startsWith("/__pay/")) {
      const inv = decodeURIComponent(url.slice("/__pay/".length));
      if (!state.has(inv)) {
        json(res, 404, { ok: false, error: "invoice tidak dikenal" });
        return;
      }
      state.set(inv, "SUCCESS");
      console.log(`[mock] __pay → ${inv} = SUCCESS`);
      json(res, 200, { ok: true, invoice: inv, status: "SUCCESS" });
      return;
    }
    if (url === "/__reset") {
      state.clear();
      json(res, 200, { ok: true });
      return;
    }
    if (url === "/__state") {
      json(res, 200, Object.fromEntries(state));
      return;
    }

    // ==== Check Status API (GET, signature tanpa Digest) ====
    if (url.startsWith("/orders/v1/status/")) {
      if (!verifySignature(req, "", url)) {
        json(res, 401, { error: { message: "Signature mismatch (status)" } });
        return;
      }
      const inv = decodeURIComponent(url.slice("/orders/v1/status/".length));
      const status = state.get(inv) ?? "PENDING";
      console.log(`[mock] status ${inv} → ${status}`);
      json(res, 200, {
        transaction: { status },
        order: { invoice_number: inv },
      });
      return;
    }

    // ==== Checkout satu-kanal / ganda ====
    if (url === "/checkout/v1/payment") {
      if (!verifySignature(req, raw, url)) {
        console.warn("[mock] checkout DITOLAK — signature salah");
        json(res, 401, { error: { message: "Signature mismatch (checkout)" } });
        return;
      }
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {}
      const inv = String(body?.order?.invoice_number ?? "UNKNOWN");
      const amount = Number(body?.order?.amount ?? 0);
      const types = JSON.stringify(body?.payment?.payment_method_types ?? []);
      state.set(inv, "PENDING");
      // expired_datetime ISO UTC (+5 menit) — pola produksi jalur 1
      const exp = new Date(Date.now() + 5 * 60 * 1000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z");
      // Kanal Virtual Account → sertakan va_number (uji parsing toleran AGSI)
      const vaNumber = types.includes("VIRTUAL_ACCOUNT")
        ? `88080${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`
        : undefined;
      console.log(`[mock] checkout ${inv} amount=${amount} types=${types}`);
      json(res, 200, {
        response: {
          order: { invoice_number: inv, amount, currency: "IDR" },
          payment: {
            url: `https://checkout.doku.com/checkout-link-v2/${inv}`,
            expired_datetime: exp,
            ...(vaNumber ? { va_number: vaNumber } : {}),
          },
        },
      });
      return;
    }

    // ==== Direct API Alfamart (O2O v2) ====
    if (url === "/alfa-online-to-offline/v2/payment-code") {
      if (!verifySignature(req, raw, url)) {
        console.warn("[mock] alfa DITOLAK — signature salah");
        json(res, 401, { error: { message: "Signature mismatch (alfa)" } });
        return;
      }
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {}
      const inv = String(body?.order?.invoice_number ?? "UNKNOWN");
      state.set(inv, "PENDING");
      const d = new Date(Date.now() + 5 * 60 * 1000 + 7 * 3600 * 1000);
      const pad = (n) => String(n).padStart(2, "0");
      const expiredDate =
        `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
        `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
      const code = String(Math.floor(1e11 + Math.random() * 8e11));
      console.log(`[mock] alfa ${inv} code=${code}`);
      json(res, 200, {
        order: { invoice_number: inv },
        online_to_offline_info: {
          payment_code: code,
          expired_date: expiredDate,
          reusable_status: false,
        },
        how_to_pay_page: `https://checkout.doku.com/how-to-pay/alfa/${inv}`,
      });
      return;
    }

    json(res, 404, { error: { message: `mock tidak tahu ${url}` } });
  });
});

server.listen(PORT, () => {
  console.log(`[mock] DOKU mock di http://localhost:${PORT} (secret: ${SECRET ? "terset" : "kosong"})`);
});
