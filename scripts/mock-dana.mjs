/**
 * Server DANA MOCK berdiri sendiri — untuk uji browser manual.
 * Meniru api.sandbox.dana.id (Generate QRIS / Query Payment / Cancel)
 * dengan verifikasi signature merchant, PLUS endpoint kontrol:
 *   POST /__mock/pay  { ref }  -> tandai PAID lalu kirim Finish Notify
 *                                 TERTANDATANGANI ke aplikasi (webhook resmi)
 *   GET  /__mock/list          -> lihat semua transaksi
 * Kunci: /tmp/dana-test-keys (merchant-public.pem utk verifikasi request,
 * dana-private.pem utk menandatangani webhook DANA).
 */
import { createServer } from "http";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as rsaSign,
  verify as rsaVerify,
} from "crypto";
import { readFileSync } from "fs";

const KEYS = process.env.KEYS_DIR ?? "/tmp/dana-test-keys";
const APP_BASE = process.env.APP_BASE ?? "http://127.0.0.1:3000";
const PORT = Number(process.env.MOCK_PORT ?? 4653);
const MERCHANT_PUB = readFileSync(`${KEYS}/merchant-public.pem`, "utf8");
const DANA_PRIV = readFileSync(`${KEYS}/dana-private.pem`, "utf8");

const sha256Hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const stringToSign = (m, p, b, t) => `${m}:${p}:${sha256Hex(b)}:${t}`;
const jakartaTs = (d = new Date()) =>
  `${d.toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" }).replace(" ", "T")}+07:00`;
const verifyMerchantSig = (p, b, s, t) => {
  try {
    return rsaVerify(
      "sha256",
      Buffer.from(stringToSign("POST", p, b, t), "utf8"),
      createPublicKey(MERCHANT_PUB),
      Buffer.from(s, "base64")
    );
  } catch {
    return false;
  }
};

const trxs = new Map();
const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

/** Kirim Finish Notify "dari DANA" ke aplikasi (signed dengan private key DANA) */
async function finishNotify(ref) {
  const trx = trxs.get(ref);
  const ts = jakartaTs();
  const body = JSON.stringify({
    originalPartnerReferenceNo: ref,
    originalReferenceNo: `DANA-REF-${Date.now()}`,
    merchantId: "216660000274111177110",
    amount: { value: `${(trx?.amount ?? 0).toFixed(2)}`, currency: "IDR" },
    latestTransactionStatus: "00",
    transactionStatusDesc: "success",
    createdTime: ts,
    finishedTime: ts,
  });
  const path = "/api/webhooks/qris";
  const res = await fetch(`${APP_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SIGNATURE": rsaSign(
        "sha256",
        Buffer.from(stringToSign("POST", path, body, ts), "utf8"),
        createPrivateKey(DANA_PRIV)
      ).toString("base64"),
      "X-TIMESTAMP": ts,
      "X-PARTNER-ID": "TEST-CLIENT-ID",
      "X-EXTERNAL-ID": randomUUID(),
      "CHANNEL-ID": "95221",
    },
    body,
  });
  return { httpStatus: res.status, body: await res.json().catch(() => ({})) };
}

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  const path = new URL(req.url ?? "/", "http://mock").pathname;
  const ts = String(req.headers["x-timestamp"] ?? "");

  // ---- endpoint kontrol (tanpa signature merchant) ----
  if (path === "/__mock/pay" && req.method === "POST") {
    const { ref } = JSON.parse(raw || "{}");
    const trx = trxs.get(String(ref));
    if (!trx) return json(res, 404, { ok: false, reason: "trx tidak ada" });
    if (trx.status === "PENDING") trx.status = "PAID";
    const notify = await finishNotify(String(ref));
    return json(res, 200, { ok: true, trx: trx.status, notify });
  }
  if (path === "/__mock/pay-silent" && req.method === "POST") {
    const { ref } = JSON.parse(raw || "{}");
    const trx = trxs.get(String(ref));
    if (!trx) return json(res, 404, { ok: false });
    if (trx.status === "PENDING") trx.status = "PAID";
    return json(res, 200, { ok: true, trx: trx.status });
  }
  if (path === "/__mock/list") {
    return json(res, 200, { trxs: [...trxs.values()] });
  }

  // ---- endpoint "API DANA" (wajib signature merchant) ----
  const sig = String(req.headers["x-signature"] ?? "");
  if (!verifyMerchantSig(path, raw, sig, ts)) {
    return json(res, 200, { responseCode: "4015000", responseMessage: "Invalid Signature" });
  }

  if (path === "/v1.0/qr/qr-mpm-generate.htm") {
    const b = JSON.parse(raw);
    const ref = String(b.partnerReferenceNo ?? "");
    if (!ref || trxs.has(ref)) {
      return json(res, 200, { responseCode: "4018001", responseMessage: "Duplicate partnerReferenceNo" });
    }
    trxs.set(ref, { ref, amount: Math.round(Number(b.amount?.value ?? 0)), status: "PENDING" });
    return json(res, 200, {
      responseCode: "2004700",
      responseMessage: "Successful",
      referenceNo: `DANA-REF-${Date.now()}`,
      partnerReferenceNo: ref,
      qrContent: `00020101021126MOCK-DANA-${ref}`,
      merchantName: "AGSI MOCK DANA",
    });
  }
  if (path === "/rest/v1.1/debit/status") {
    const b = JSON.parse(raw);
    const trx = trxs.get(String(b.originalPartnerReferenceNo ?? ""));
    return json(res, 200, {
      responseCode: "2005500",
      responseMessage: "Successful",
      originalPartnerReferenceNo: String(b.originalPartnerReferenceNo ?? ""),
      latestTransactionStatus: trx?.status === "PAID" ? "00" : trx ? "01" : "07",
    });
  }
  if (path === "/v1.0/debit/cancel.htm") {
    const b = JSON.parse(raw);
    const trx = trxs.get(String(b.originalPartnerReferenceNo ?? ""));
    if (trx && trx.status === "PENDING") trx.status = "CANCELLED";
    return json(res, 200, { responseCode: "2005700", responseMessage: "Successful" });
  }
  json(res, 404, { responseCode: "4004000", responseMessage: "Not Found" });
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[MOCK] DANA API mock: http://127.0.0.1:${PORT} (app: ${APP_BASE})`);
});
