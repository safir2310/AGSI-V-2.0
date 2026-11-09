/**
 * Penyedia QRIS via DOKU (https://api-sandbox.doku.com / https://api.doku.com).
 *
 * DOKU punya DUA jalur integrasi — adapter ini memakai yang kredensialnya
 * tersedia (jalur SNAP REST lebih diutamakan bila lengkap):
 *
 *  1) JALUR SNAP REST — QRIS MPM Direct API (lihat developers.doku.com):
 *     a. Token B2B      : POST /authorization/v1/access-token/b2b
 *        X-SIGNATURE    : HMAC_SHA512(clientSecret, clientId+"|"+timestamp)
 *                         atau SHA256withRSA(privateKey, sama string) bila
 *                         DOKU_PRIVATE_KEY diset.
 *     b. Generate QRIS  : POST /snap-adapter/b2b/v1.0/qr/qr-mpm-generate
 *        X-SIGNATURE    : HMAC_SHA512(clientSecret, "POST:<path>:<accessToken>:
 *                         <hex(sha256(minifiedBody))>:<timestamp>")
 *        -> response.qrContent = string QRIS EMVCo siap dirender.
 *     c. Query status   : POST /snap-adapter/b2b/v1.0/qr/qr-mpm-query
 *        -> latestTransactionStatus: "00" sukses, "01"/"02"/"03" menunggu,
 *           "05"/"06"/"07"/"08" gagal/kedaluwarsa.
 *     d. Expire QR      : POST /snap-adapter/b2b/v1.0/qr/qr-expire
 *
 *  2) JALUR API KEY AGENTIC (MCP DOKU — JSON-RPC POST /doku-mcp-server/mcp,
 *     Authorization: Basic base64(apiKey + ":")):
 *     a. tools/call create_qris_payment -> QRIS dinamis (amount, invoice).
 *     b. tools/call get_transaction_by_invoice_number -> cari status transaksi.
 *     Kedua tool dipanggil langsung dari backend (server-to-server).
 *
 * Alur pelunasan (kebijakan toko — hanya SISTEM yang boleh melunaskan):
 *   polling /api/orders/[id]/qris/status memanggil getQrisDokuStatus()
 *   (query ke DOKU) -> PAID hanya bila DOKU sendiri mengatakan dana masuk;
 *   webhook DOKU (/api/webhooks/qris) juga SELALU konfirmasi ulang lewat
 *   query sebelum memanggil markOrderPaidBySystem() — fail-closed.
 */
import { createHash, createHmac, createSign } from "crypto";
import {
  DOKU_API_BASE,
  DOKU_API_KEY,
  DOKU_APIKEY_READY,
  DOKU_CHECKOUT_CALLBACK_URL,
  DOKU_CHECKOUT_READY,
  DOKU_CLIENT_ID,
  DOKU_CLIENT_SECRET,
  DOKU_IS_PRODUCTION,
  DOKU_MERCHANT_ID,
  DOKU_MCP_PATH,
  DOKU_POSTAL_CODE,
  DOKU_PRIVATE_KEY,
  DOKU_QRIS_EXPIRY_MINUTES,
  DOKU_SNAP_READY,
  DOKU_TERMINAL_ID,
  DOKU_TRX_PREFIX,
} from "@/lib/qris-config";
import {
  normalizeGatewayStatus,
  QrisGatewayError,
  type GatewayStatus,
  type GatewayTransaction,
} from "@/lib/qris-provider";

/**
 * Kanal checkout untuk pesanan E-WALLET.
 * Semua e-wallet DOKU diminta; DOKU hanya menampilkan yang AKTIF untuk
 * merchant (yang belum aktif di-drop diam-diam). VIRTUAL_ACCOUNT_DOKU
 * disertakan sebagai kanal cadangan — filter yang hanya berisi kanal
 * tidak-aktif ditolak 400 "PLEASE USE ANOTHER PAYMENT METHOD".
 * Saat DANA/OVO/ShopeePay/LinkAja diaktifkan DOKU untuk akun ini, kanal
 * tersebut OTOMATIS muncul di halaman bayar tanpa perubahan kode.
 */
export const DOKU_EWALLET_CHANNEL_TYPES = [
  "EMONEY_DOKU",
  "EMONEY_DANA",
  "EMONEY_OVO",
  "EMONEY_SHOPEE_PAY",
  "EMONEY_LINKAJA",
  "VIRTUAL_ACCOUNT_DOKU",
];

// ============================================================
//  Utilitas bersama
// ============================================================

/** true bila trxId ini milik DOKU (prefix "DOKU-") */
export function isDokuTrx(trxId: string): boolean {
  return trxId.startsWith(`${DOKU_TRX_PREFIX}-`);
}

/**
 * Waktu WIB berformat SNAP "YYYY-MM-DDTHH:mm:ss+07:00" — format yang
 * diminta X-TIMESTAMP & validityPeriod DOKU (waktu lokal Jakarta UTC+7).
 */
function wibTimestamp(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+07:00`;
}

/** X-EXTERNAL-ID: string NUMERIK unik dalam hari yang sama */
function externalId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;
}

/** partnerReferenceNo DOKU = "DOKU-<kode pesanan>" (maks 64 karakter) */
function partnerReferenceNoOf(reference: string): string {
  const raw = reference.startsWith(`${DOKU_TRX_PREFIX}-`)
    ? reference
    : `${DOKU_TRX_PREFIX}-${reference}`;
  return raw.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 64);
}

/** Pemetaan kode status SNAP DOKU -> status baku aplikasi */
function snapStatusToGateway(raw: unknown): GatewayStatus {
  const s = String(raw ?? "").trim();
  switch (s) {
    case "00": // Success
      return "PAID";
    case "01": // Initiated
    case "02": // Paying
    case "03": // Pending
    case "09": // Denied... masih bisa berubah — perlakukan menunggu
      return "PENDING";
    case "04": // Refunded
    case "05": // Canceled
    case "06": // Failed
    case "07": // Void
    case "08": // Expired
      return "EXPIRED";
    default:
      return "UNKNOWN";
  }
}

/** Cari string QRIS EMVCo di dalam objek respons apa pun (toleran struktur) */
function findQrString(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || value == null) return undefined;
  if (typeof value === "string") {
    const v = value.trim();
    if (v.startsWith("000201") || v.includes("ID.CO.QRIS.WWW")) return v;
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findQrString(item, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = findQrString(v, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

/** Urai teks hasil tool MCP — berupa JSON string (kadang dibungkus) */
function parseMcpText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  // Kadang respons diawali "..." langsung JSON; coba parse utuh dulu
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // bukan JSON utuh — coba ekstrak bagian {..} pertama
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Ambil pesan galat terbaca dari objek galat DOKU */
function messageOf(obj: Record<string, unknown> | null, fallback: string): string {
  if (!obj) return fallback;
  const parts: string[] = [];
  for (const key of ["responseMessage", "message", "error", "errorMessage"]) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
  }
  return parts.join(" — ") || fallback;
}

// ============================================================
//  JALUR SNAP REST — token, generate, query, expire
// ============================================================

// Cache token B2B (berlaku 900 detik) — satu token dipakai ulang semua request
let cachedToken: { token: string; expiresAt: number } | null = null;

/** HMAC_SHA512 base64 — signature simetris SNAP */
function hmac512(secret: string, stringToSign: string): string {
  return createHmac("sha512", secret).update(stringToSign).digest("base64");
}

/** SHA256withRSA base64 — signature asimetris SNAP (bila private key diset) */
function rsaSign(privateKeyPem: string, stringToSign: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(stringToSign);
  return signer.sign(privateKeyPem, "base64");
}

/** Normalisasi PEM satu baris (env Vercel) -> PEM utuh */
function normalizePem(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  const withBreaks = v.includes("\\n") ? v.replace(/\\n/g, "\n") : v;
  if (withBreaks.includes("-----BEGIN")) return withBreaks.trim();
  return `-----BEGIN PRIVATE KEY-----\n${withBreaks}\n-----END PRIVATE KEY-----`;
}

/**
 * POST /authorization/v1/access-token/b2b — token B2B (cache 13 menit).
 * Signature: simetris HMAC (default) atau asimetris RSA (bila private key).
 */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  if (!DOKU_CLIENT_ID || !DOKU_CLIENT_SECRET) {
    throw new QrisGatewayError("Kredensial DOKU (Client ID/Secret) belum lengkap.");
  }
  const path = "/authorization/v1/access-token/b2b";
  const timestamp = wibTimestamp();
  const stringToSign = `${DOKU_CLIENT_ID}|${timestamp}`;
  const signature = DOKU_PRIVATE_KEY
    ? rsaSign(normalizePem(DOKU_PRIVATE_KEY), stringToSign)
    : hmac512(DOKU_CLIENT_SECRET, stringToSign);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let httpStatus = 0;
  let body: Record<string, unknown>;
  try {
    const res = await fetch(`${DOKU_API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CLIENT-KEY": DOKU_CLIENT_ID,
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
      },
      body: JSON.stringify({ grantType: "client_credentials" }),
      signal: controller.signal,
      cache: "no-store",
    });
    httpStatus = res.status;
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new QrisGatewayError("DOKU tidak merespons saat ambil token (timeout).");
    }
    throw new QrisGatewayError("Tidak dapat menghubungi DOKU (token).");
  } finally {
    clearTimeout(timer);
  }

  const token = typeof body.accessToken === "string" ? body.accessToken : "";
  if (httpStatus >= 300 || !token) {
    throw new QrisGatewayError(
      `DOKU menolak permintaan token (HTTP ${httpStatus}). ${messageOf(body, "Periksa DOKU_CLIENT_ID / DOKU_CLIENT_SECRET.")}`,
      httpStatus === 401 ? 401 : undefined
    );
  }
  const expiresIn = Number(body.expiresIn ?? 900) || 900;
  cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

/** POST ke endpoint SNAP dengan header signature lengkap */
async function snapPost(
  path: string,
  payload: Record<string, unknown>,
  timeoutMs = 15_000
): Promise<Record<string, unknown>> {
  const accessToken = await getAccessToken();
  const timestamp = wibTimestamp();
  const minified = JSON.stringify(payload);
  const bodyHash = createHash("sha256").update(minified).digest("hex").toLowerCase();
  const stringToSign = `POST:${path}:${accessToken}:${bodyHash}:${timestamp}`;
  const signature = hmac512(DOKU_CLIENT_SECRET, stringToSign);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let httpStatus = 0;
  let body: Record<string, unknown>;
  try {
    const res = await fetch(`${DOKU_API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-PARTNER-ID": DOKU_CLIENT_ID,
        "X-EXTERNAL-ID": externalId(),
        "X-TIMESTAMP": timestamp,
        "X-SIGNATURE": signature,
        Authorization: `Bearer ${accessToken}`,
        "CHANNEL-ID": "H2H",
      },
      body: minified,
      signal: controller.signal,
      cache: "no-store",
    });
    httpStatus = res.status;
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new QrisGatewayError("DOKU tidak merespons (timeout).");
    }
    throw new QrisGatewayError("Tidak dapat menghubungi DOKU. Periksa koneksi internet server.");
  } finally {
    clearTimeout(timer);
  }

  if (httpStatus >= 400) {
    throw new QrisGatewayError(
      `DOKU menolak ${path} (HTTP ${httpStatus}). ${messageOf(body, "")}`,
      httpStatus === 404 ? 404 : httpStatus === 401 ? 401 : undefined
    );
  }
  return body;
}

/** Generate QRIS via SNAP: response.qrContent */
async function snapGenerateQris(opts: {
  partnerReferenceNo: string;
  amount: number;
  validityPeriod: string;
}): Promise<string> {
  const body = await snapPost("/snap-adapter/b2b/v1.0/qr/qr-mpm-generate", {
    partnerReferenceNo: opts.partnerReferenceNo,
    amount: { value: `${opts.amount}.00`, currency: "IDR" },
    merchantId: DOKU_MERCHANT_ID,
    terminalId: DOKU_TERMINAL_ID,
    validityPeriod: opts.validityPeriod,
    additionalInfo: { postalCode: DOKU_POSTAL_CODE, feeType: "1" },
  });
  // findQrString mencari string EMVCo di kedalaman mana pun — menangkap
  // body.qrContent maupun body.response.qrContent sekaligus.
  const qr = findQrString(body);
  if (!qr) {
    throw new QrisGatewayError("DOKU tidak mengembalikan kode QR (qrContent).");
  }
  return qr;
}

/** Query status via SNAP: latestTransactionStatus */
async function snapQueryStatus(partnerReferenceNo: string): Promise<GatewayStatus> {
  const body = await snapPost(
    "/snap-adapter/b2b/v1.0/qr/qr-mpm-query",
    {
      originalReferenceNo: partnerReferenceNo,
      originalPartnerReferenceNo: partnerReferenceNo,
      serviceCode: "47",
      merchantId: DOKU_MERCHANT_ID,
    },
    10_000
  );
  return snapStatusToGateway(body.latestTransactionStatus);
}

/** Expire QR via SNAP (batalkan transaksi pending) */
async function snapExpireQris(partnerReferenceNo: string): Promise<void> {
  await snapPost(
    "/snap-adapter/b2b/v1.0/qr/qr-expire",
    {
      partnerReferenceNo,
      referenceNo: partnerReferenceNo,
      merchantId: DOKU_MERCHANT_ID,
      reason: "Pesanan dibatalkan sistem AGSI",
    },
    10_000
  );
}

// ============================================================
//  JALUR API KEY AGENTIC — MCP DOKU (JSON-RPC)
// ============================================================

let mcpRequestId = 0;

/** Panggil satu tool MCP DOKU; kembalikan objek hasil terurai */
async function mcpCallTool(
  toolName: string,
  toolRequest: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  if (!DOKU_APIKEY_READY) {
    throw new QrisGatewayError("API key DOKU belum dikonfigurasi di .env (DOKU_API_KEY).");
  }
  const basic = Buffer.from(`${DOKU_API_KEY}:`).toString("base64");
  const id = ++mcpRequestId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let httpStatus = 0;
  let raw = "";
  try {
    const res = await fetch(`${DOKU_API_BASE}${DOKU_MCP_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: toolName, arguments: { toolRequest } },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    httpStatus = res.status;
    raw = await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new QrisGatewayError("MCP DOKU tidak merespons (timeout).");
    }
    throw new QrisGatewayError("Tidak dapat menghubungi MCP DOKU. Periksa koneksi internet server.");
  } finally {
    clearTimeout(timer);
  }

  if (httpStatus >= 400) {
    throw new QrisGatewayError(
      `MCP DOKU menolak panggilan (HTTP ${httpStatus}).`,
      httpStatus === 401 ? 401 : undefined
    );
  }

  // Respons MCP bisa JSON murni ATAU SSE ("data: {...}") — urai toleran
  let envelope: Record<string, unknown> | null = null;
  const direct = parseMcpText(raw);
  if (direct && typeof direct.result === "object") {
    envelope = direct;
  } else {
    for (const line of raw.split("\n")) {
      const trimmedLine = line.trim();
      if (!trimmedLine.startsWith("data:")) continue;
      const parsed = parseMcpText(trimmedLine.slice(5));
      if (parsed && parsed.id === id && typeof parsed.result === "object") {
        envelope = parsed;
        break;
      }
    }
  }
  if (!envelope) {
    throw new QrisGatewayError("Respons MCP DOKU tidak dapat diurai.");
  }
  const result = envelope.result as Record<string, unknown> | undefined;
  if (!result) return null;
  if (result.isError === true) {
    throw new QrisGatewayError(`Tool DOKU ${toolName} gagal. ${messageOf(null, raw.slice(0, 300))}`);
  }
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0] as { type?: unknown; text?: unknown };
  if (typeof first?.text !== "string") return null;
  const parsed = parseMcpText(first.text);
  if (parsed && (typeof parsed.error === "string" || typeof parsed.errorMessage === "string")) {
    throw new QrisGatewayError(
      `DOKU menolak ${toolName}: ${messageOf(parsed, "Service temporarily unavailable")}`
    );
  }
  return parsed;
}

/** Generate QRIS via MCP create_qris_payment — cari string QR di respons */
async function mcpCreateQris(opts: {
  partnerReferenceNo: string;
  amount: number;
  validityPeriod: string;
}): Promise<string> {
  const parsed = await mcpCallTool("create_qris_payment", {
    amount: `${opts.amount}.00`,
    partnerReferenceNo: opts.partnerReferenceNo,
    postalCode: DOKU_POSTAL_CODE,
    validityPeriod: opts.validityPeriod,
  });
  if (!parsed) {
    throw new QrisGatewayError("DOKU tidak mengembalikan hasil QRIS.");
  }
  const qr = findQrString(parsed);
  if (!qr) {
    throw new QrisGatewayError(
      `DOKU tidak mengembalikan kode QR. ${messageOf(parsed, "Periksa status kanal QRIS di dashboard DOKU.")}`
    );
  }
  return qr;
}

/** Cari entri transaksi sesuai invoice di dalam objek respons (rekursif) */
function findTransactionEntry(
  value: unknown,
  invoice: string,
  depth = 0
): Record<string, unknown> | null {
  if (depth > 6 || value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findTransactionEntry(item, invoice, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of [
      "invoiceNumber",
      "invoice_number",
      "partnerReferenceNo",
      "partner_reference_no",
      "originalPartnerReferenceNo",
      "originalReferenceNo",
      "referenceNo",
    ]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim() === invoice) return obj;
    }
    for (const v of Object.values(obj)) {
      const hit = findTransactionEntry(v, invoice, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Status via MCP get_transaction_by_invoice_number */
async function mcpQueryStatus(partnerReferenceNo: string): Promise<GatewayStatus> {
  const now = new Date();
  const ddmm = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  const start = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  let parsed: Record<string, unknown> | null;
  try {
    parsed = await mcpCallTool("get_transaction_by_invoice_number", {
      invoiceNumber: partnerReferenceNo,
      startDate: ddmm(start),
      endDate: ddmm(end),
      pageNumber: 1,
      pageSize: 10,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    // DOKU: laporan transaksi kosong / belum ada catatan = transaksi belum
    // ada (belum dibayar) — bukan galat; QR tetap menunggu pembayaran.
    if (msg.includes("searchfailed") || msg.includes("unable to complete search")) {
      return "PENDING";
    }
    throw err;
  }
  if (!parsed) return "PENDING";

  // DOKU: transaksi belum tercatat (belum dibayar) -> tetap menunggu.
  const entry = findTransactionEntry(parsed, partnerReferenceNo);
  if (!entry) return "PENDING";

  // Kode SNAP (00/03/...) diutamakan; kalau tidak ada, pakai kata status.
  const codeKeys = [
    "latestTransactionStatus",
    "transactionStatus",
    "trxStatus",
    "status_code",
    "statusCode",
  ];
  for (const k of codeKeys) {
    if (entry[k] != null) {
      const mapped = snapStatusToGateway(entry[k]);
      if (mapped !== "UNKNOWN") return mapped;
    }
  }
  const wordKeys = ["transactionStatusDesc", "status", "transaction_status", "paymentStatus"];
  for (const k of wordKeys) {
    const v = entry[k];
    if (typeof v === "string" && v.trim()) {
      const s = v.trim().toLowerCase();
      if (s === "success" || s === "success payment" || s === "paid") return "PAID";
      if (s.includes("success")) return "PAID";
      if (s.includes("pending") || s.includes("waiting") || s.includes("unpaid")) return "PENDING";
      if (s.includes("expired") || s.includes("cancel") || s.includes("failed") || s.includes("refund"))
        return "EXPIRED";
    }
  }
  return "PENDING";
}

// ============================================================
//  JALUR CHECKOUT LEGACY (Non-SNAP) — produksi, TERBUKTI HIDUP
// ============================================================
// Bila kredensial SNAP belum terdaftar di gateway SNAP (4017300
// "Unauthorized. Unknown Client") tetapi Client ID + Secret Key VALID di
// gateway legacy Non-SNAP (divalidasi lewat Check Status API), transaksi
// dibuat via DOKU CHECKOUT:
//   POST /checkout/v1/payment        -> response.payment.url (halaman bayar
//     DOKU berisi kanal aktif merchant — QRIS tampil di sana begitu kanal
//     QRIS akun diaktifkan DOKU; sementara VA/retail/e-money aktif)
//   GET  /orders/v1/status/{invoice} -> transaction.status
// Signature legacy: HMAC-SHA256 atas "Client-Id\nRequest-Id\nRequest-
// Timestamp\nRequest-Target\nDigest" (HMACSHA256= prefix).

/** Header autentikasi legacy Non-SNAP — nilai TERKIRIM persis (HMACSHA256=) */
function legacyHeaders(
  target: string,
  bodyRaw: string | null
): Record<string, string> {
  const requestId = externalId();
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const parts = [
    `Client-Id:${DOKU_CLIENT_ID}`,
    `Request-Id:${requestId}`,
    `Request-Timestamp:${ts}`,
    `Request-Target:${target}`,
  ];
  if (bodyRaw !== null) {
    parts.push(
      `Digest:${createHash("sha256").update(bodyRaw).digest("base64")}`
    );
  }
  return {
    "Client-Id": DOKU_CLIENT_ID,
    "Request-Id": requestId,
    "Request-Timestamp": ts,
    "Request-Target": target,
    Signature: `HMACSHA256=${createHmac("sha256", DOKU_CLIENT_SECRET)
      .update(parts.join("\n"))
      .digest("base64")}`,
    ...(bodyRaw !== null ? { "Content-Type": "application/json" } : {}),
  };
}

/** Pesan galat terbaca dari respons legacy (message bisa string/array) */
function legacyErrorMessage(
  body: Record<string, unknown>,
  fallback: string
): string {
  const err = body.error;
  if (err && typeof err === "object" && !Array.isArray(err)) {
    const m = (err as Record<string, unknown>).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  const msg = body.message;
  if (typeof msg === "string" && msg.trim()) return msg;
  if (Array.isArray(msg)) {
    const joined = msg.filter((v) => typeof v === "string").join(", ");
    if (joined) return joined;
  }
  if (typeof body.responseMessage === "string" && body.responseMessage.trim()) {
    return body.responseMessage;
  }
  return fallback;
}

/** POST legacy dengan timeout + galat terurai */
async function legacyPost(
  path: string,
  payload: Record<string, unknown>,
  timeoutMs = 20_000
): Promise<Record<string, unknown>> {
  const raw = JSON.stringify(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let httpStatus = 0;
  let body: Record<string, unknown>;
  try {
    const res = await fetch(`${DOKU_API_BASE}${path}`, {
      method: "POST",
      headers: legacyHeaders(path, raw),
      body: raw,
      signal: controller.signal,
      cache: "no-store",
    });
    httpStatus = res.status;
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new QrisGatewayError("DOKU Checkout tidak merespons (timeout).");
    }
    throw new QrisGatewayError(
      "Tidak dapat menghubungi DOKU Checkout. Periksa koneksi internet server."
    );
  } finally {
    clearTimeout(timer);
  }
  if (httpStatus >= 300) {
    throw new QrisGatewayError(
      `DOKU Checkout menolak ${path} (HTTP ${httpStatus}). ${legacyErrorMessage(body, "")}`.trim(),
      httpStatus === 404 ? 404 : httpStatus === 401 ? 401 : undefined
    );
  }
  return body;
}

/** GET legacy (tanpa Digest) — 404 berarti invoice tidak dikenal */
async function legacyGet(
  path: string,
  timeoutMs = 15_000
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let httpStatus = 0;
  let body: Record<string, unknown>;
  try {
    const res = await fetch(`${DOKU_API_BASE}${path}`, {
      method: "GET",
      headers: legacyHeaders(path, null),
      signal: controller.signal,
      cache: "no-store",
    });
    httpStatus = res.status;
    body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new QrisGatewayError("DOKU tidak merespons (timeout).");
    }
    throw new QrisGatewayError("Tidak dapat menghubungi DOKU (status).");
  } finally {
    clearTimeout(timer);
  }
  if (httpStatus === 404) {
    throw new QrisGatewayError(
      "Transaksi tidak ditemukan di DOKU.",
      404
    );
  }
  if (httpStatus >= 300) {
    throw new QrisGatewayError(
      `DOKU menolak ${path} (HTTP ${httpStatus}). ${legacyErrorMessage(body, "")}`.trim(),
      httpStatus === 401 ? 401 : undefined
    );
  }
  return body;
}

/** Cari URL halaman bayar DOKU di kedalaman mana pun (toleran struktur) */
function findPaymentUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || value == null) return undefined;
  if (typeof value === "string") {
    const v = value.trim();
    if (
      v.startsWith("https://") &&
      (v.includes("checkout.doku.com") || v.includes("/checkout-link-v2/"))
    ) {
      return v;
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findPaymentUrl(item, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const hit = findPaymentUrl(v, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * Buat pesanan DOKU Checkout (jalur legacy produksi).
 * Halaman bayar menampilkan semua kanal AKTIF merchant (QRIS, VA, retail,
 * e-money, paylater) — sesuai konfigurasi akun DOKU. `channelTypes` bila
 * diisi memfilter halaman bayar ke kanal tertentu (mis. pesanan e-wallet);
 * bila filter ditolak DOKU (semua kanal diminta belum aktif), di-retry SEKALI
 * tanpa filter supaya pelanggan tetap dapat halaman bayar.
 * Status tetap diverifikasi otomatis (polling Check Status + webhook legacy).
 */
async function checkoutCreateQris(opts: {
  partnerReferenceNo: string;
  amount: number;
  channelTypes?: string[];
}): Promise<GatewayTransaction> {
  const payload = {
    order: {
      invoice_number: opts.partnerReferenceNo,
      amount: opts.amount,
      currency: "IDR",
      callback_url: DOKU_CHECKOUT_CALLBACK_URL,
      language: "id",
      additional_info: {},
      line_items: [
        {
          name: `Pesanan ${opts.partnerReferenceNo.replace(/^DOKU-/, "")}`.slice(0, 60),
          quantity: 1,
          price: opts.amount,
        },
      ],
    },
    payment: {
      payment_due_date: DOKU_QRIS_EXPIRY_MINUTES,
      enable_saves: false,
      enable_paylater: false,
      ...(opts.channelTypes && opts.channelTypes.length > 0
        ? { payment_method_types: opts.channelTypes }
        : {}),
    },
    customer: { name: "Pelanggan AGSI", email: "pos@agsi.co.id" },
  };

  let body: Record<string, unknown>;
  let partnerRef = opts.partnerReferenceNo;
  try {
    body = await legacyPost("/checkout/v1/payment", payload);
  } catch (err) {
    // Filter kanal ditolak (semua kanal yang diminta belum aktif di akun)
    // -> sekali lagi TANPA filter: halaman bayar menampilkan semua kanal aktif.
    const msg = (err instanceof Error ? err.message : "").toLowerCase();
    if (opts.channelTypes && msg.includes("please use another payment method")) {
      const unfiltered = {
        ...payload,
        payment: { ...payload.payment },
      };
      delete (unfiltered.payment as Record<string, unknown>).payment_method_types;
      body = await legacyPost("/checkout/v1/payment", unfiltered);
      return finishCheckoutCreate(body, opts.partnerReferenceNo);
    }
    // Invoice duplikat (kode dibuat ulang setelah kedaluwarsa) -> sekali
    // coba lagi dengan suffix unik agar pelanggan tetap dapat halaman bayar.
    if (
      (err instanceof QrisGatewayError && err.status === 400) ||
      msg.includes("invoice") ||
      msg.includes("duplicate") ||
      msg.includes("exist")
    ) {
      const retryPayload = {
        ...payload,
        order: {
          ...payload.order,
          invoice_number: `${opts.partnerReferenceNo}-${Date.now().toString(36)}`,
        },
      };
      partnerRef = retryPayload.order.invoice_number;
      body = await legacyPost("/checkout/v1/payment", retryPayload);
      return finishCheckoutCreate(body, partnerRef);
    }
    throw err;
  }
  return finishCheckoutCreate(body, opts.partnerReferenceNo);
}

/** Urai respons Checkout sukses -> GatewayTransaction */
function finishCheckoutCreate(
  body: Record<string, unknown>,
  partnerReferenceNo: string
): GatewayTransaction {
  const paymentUrl = findPaymentUrl(body);
  if (!paymentUrl) {
    throw new QrisGatewayError(
      `DOKU Checkout tidak mengembalikan URL pembayaran. ${legacyErrorMessage(body, "")}`.trim()
    );
  }
  // expired_datetime contoh: "2026-11-09T08:47:21Z" (UTC ISO)
  let expiresAt: string | null = null;
  const resp = body.response as Record<string, unknown> | undefined;
  const payment = (resp?.payment ?? body.payment) as
    | Record<string, unknown>
    | undefined;
  const exp = payment?.expired_datetime ?? payment?.expired_date;
  if (typeof exp === "string" && exp.trim()) {
    // "20261109154721" (WIB tanpa tz) atau ISO — normalkan
    const digits = exp.replace(/\D/g, "");
    if (digits.length === 14) {
      const d = new Date(
        `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}+07:00`
      );
      if (!Number.isNaN(d.getTime())) expiresAt = d.toISOString();
    } else {
      const d = new Date(exp);
      if (!Number.isNaN(d.getTime())) expiresAt = d.toISOString();
    }
  }
  return {
    trxId: partnerReferenceNo,
    paymentUrl,
    expiresAt: expiresAt ?? undefined,
  };
}

/**
 * Status via Check Status API legacy: GET /orders/v1/status/{invoice}.
 * transaction.status: SUCCESS -> PAID; PENDING/ORDER_GENERATED -> PENDING;
 * EXPIRED/FAILED/TIMEOUT/CANCELLED -> EXPIRED.
 */
async function checkoutQueryStatus(
  partnerReferenceNo: string
): Promise<GatewayStatus> {
  const body = await legacyGet(
    `/orders/v1/status/${encodeURIComponent(partnerReferenceNo)}`
  );
  const transaction = body.transaction as Record<string, unknown> | undefined;
  const order = body.order as Record<string, unknown> | undefined;
  const raw =
    (transaction && typeof transaction.status === "string"
      ? transaction.status
      : null) ??
    (order && typeof order.status === "string"
      ? order.status
      : null) ??
    "";
  const s = raw.toUpperCase();
  if (!s) return "UNKNOWN";
  if (
    s === "SUCCESS" ||
    s === "ORDER_PAID" ||
    s === "PAID" ||
    s === "SETTLEMENT" ||
    s === "COMPLETED"
  ) {
    return "PAID";
  }
  if (
    s === "PENDING" ||
    s === "ORDER_GENERATED" ||
    s === "WAITING" ||
    s === "INITIATED"
  ) {
    return "PENDING";
  }
  if (
    s === "EXPIRED" ||
    s === "ORDER_EXPIRED" ||
    s === "ORDER_CANCELLED" ||
    s === "CANCELLED" ||
    s === "CANCELED" ||
    s === "FAILED" ||
    s === "TIMEOUT" ||
    s === "VOID"
  ) {
    return "EXPIRED";
  }
  return normalizeGatewayStatus(raw);
}

// ============================================================
//  API ADAPTER — dipakai qris-gateway.ts & webhook
// ============================================================

/**
 * Buat transaksi QRIS dinamis DOKU.
 * trxId yang disimpan di Order.qrisTrxId = "DOKU-<kode pesanan>" — dipakai
 * juga sebagai partnerReferenceNo / invoice number di DOKU.
 *
 * channelMode "EWALLET": halaman bayar DOKU difilter ke kanal e-wallet
 * (lihat DOKU_EWALLET_CHANNEL_TYPES). Tanpa channelMode: semua kanal aktif.
 *
 * Prioritas jalur:
 *   1) SNAP MPM (kalau MID terpasang) — QR string langsung
 *   2) CHECKOUT legacy (Client ID + Secret) — halaman bayar DOKU
 *   3) MCP API key agentic — QR string via create_qris_payment
 */
export async function createQrisDokuPayment(opts: {
  amount: number;
  reference: string;
  channelMode?: "EWALLET";
}): Promise<GatewayTransaction> {
  const amount = Math.round(Number(opts.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new QrisGatewayError("Nominal QRIS harus angka lebih dari 0.");
  }
  const partnerReferenceNo = partnerReferenceNoOf(opts.reference);

  if (DOKU_SNAP_READY) {
    const validityPeriod = wibTimestamp(
      new Date(Date.now() + DOKU_QRIS_EXPIRY_MINUTES * 60_000)
    );
    const qrString = await snapGenerateQris({
      partnerReferenceNo,
      amount,
      validityPeriod,
    });
    return {
      trxId: partnerReferenceNo,
      qrString,
      expiresAt: new Date(Date.now() + DOKU_QRIS_EXPIRY_MINUTES * 60_000).toISOString(),
    };
  }

  if (DOKU_CHECKOUT_READY) {
    return checkoutCreateQris({
      partnerReferenceNo,
      amount,
      ...(opts.channelMode === "EWALLET"
        ? { channelTypes: DOKU_EWALLET_CHANNEL_TYPES }
        : {}),
    });
  }

  const validityPeriod = wibTimestamp(
    new Date(Date.now() + DOKU_QRIS_EXPIRY_MINUTES * 60_000)
  );
  const qrString = await mcpCreateQris({ partnerReferenceNo, amount, validityPeriod });
  return {
    trxId: partnerReferenceNo,
    qrString,
    expiresAt: new Date(Date.now() + DOKU_QRIS_EXPIRY_MINUTES * 60_000).toISOString(),
  };
}

/**
 * Cek status transaksi DOKU.
 * Jalur SNAP: transaksi tak dikenal (404) -> lempar 404 agar layar bayar
 * membuat kode baru. Jalur CHECKOUT (Check Status API): 404 -> sama.
 * Jalur MCP (pencarian laporan): hasil kosong = belum ada
 * catatan -> PENDING (QR tetap; jangan regenerasi tiap poll).
 */
export async function getQrisDokuStatus(trxId: string): Promise<GatewayStatus> {
  if (DOKU_SNAP_READY) {
    return snapQueryStatus(partnerReferenceNoOf(trxId));
  }
  if (DOKU_CHECKOUT_READY) {
    return checkoutQueryStatus(partnerReferenceNoOf(trxId));
  }
  return mcpQueryStatus(partnerReferenceNoOf(trxId));
}

export type DokuCancelResult = {
  cancelled: boolean;
  alreadyPaid: boolean;
  providerStatus: string | null;
};

/**
 * Batalkan QRIS di DOKU (qr-expire). Jalur MCP tidak punya tool cancel —
 * dikembalikan no-op aman: QR otomatis mati saat validityPeriod terlewat.
 */
export async function cancelQrisDokuPayment(trxId: string): Promise<DokuCancelResult> {
  const partnerReferenceNo = partnerReferenceNoOf(trxId);
  if (!DOKU_SNAP_READY) {
    // Jalur CHECKOUT/MCP tidak punya cancel yang dipakai — QR/halaman bayar
    // otomatis mati saat payment_due_date terlewat (sama dengan validityPeriod).
    return { cancelled: false, alreadyPaid: false, providerStatus: "no_cancel_tool" };
  }
  try {
    // Cek dulu: sudah dibayar? Jangan mematikan QR yang barusan dibayar.
    const status = await snapQueryStatus(partnerReferenceNo);
    if (status === "PAID") {
      return { cancelled: false, alreadyPaid: true, providerStatus: "00" };
    }
    if (status === "EXPIRED") {
      return { cancelled: true, alreadyPaid: false, providerStatus: "expired" };
    }
    await snapExpireQris(partnerReferenceNo);
    return { cancelled: true, alreadyPaid: false, providerStatus: "expired_by_merchant" };
  } catch (err) {
    if (err instanceof QrisGatewayError && err.status === 404) {
      return { cancelled: true, alreadyPaid: false, providerStatus: "not_found" };
    }
    throw err;
  }
}

/**
 * Verifikasi signature HTTP NOTIFICATION DOKU (HMAC-SHA512 simetris).
 * Rumus SNAP: HMAC_SHA512(clientSecret, "POST:<path>:<accessToken>:
 * <hex(sha256(body))>:<timestamp>"). Notifikasi tidak membawa access token —
 * dicoba juga varian tanpa komponen token (fail-closed: hanya cocok yang benar).
 */
export function verifyDokuWebhookSignature(opts: {
  signature: string;
  timestamp: string;
  rawBody: string;
  paths: string[];
}): boolean {
  if (!DOKU_CLIENT_SECRET) return false;
  const got = opts.signature.trim();
  if (!got) return false;
  const bodyHash = createHash("sha256")
    .update(opts.rawBody)
    .digest("hex")
    .toLowerCase();
  const candidates: string[] = [];
  for (const p of opts.paths) {
    candidates.push(`POST:${p}::${bodyHash}:${opts.timestamp}`);
    candidates.push(`POST:${p}:::${opts.timestamp}`);
  }
  for (const s of candidates) {
    const expected = hmac512(DOKU_CLIENT_SECRET, s);
    if (expected.length === got.length && expected === got) return true;
  }
  return false;
}

/**
 * Verifikasi signature NOTIFIKASI legacy (Non-SNAP / DOKU Checkout).
 * Header: Client-Id, Request-Id, Request-Timestamp, Request-Target, Signature.
 * Rumus: "HMACSHA256=" + Base64(HMAC-SHA256(secret,
 *   "Client-Id:..\nRequest-Id:..\nRequest-Timestamp:..\nRequest-Target:..\nDigest:<base64(sha256(body))>"))
 * Fail-closed: hanya signature yang benar diterima.
 */
export function verifyDokuLegacyWebhookSignature(opts: {
  signature: string;
  clientId?: string;
  requestId: string;
  timestamp: string;
  target: string;
  rawBody: string;
}): boolean {
  if (!DOKU_CLIENT_SECRET) return false;
  const got = opts.signature.trim();
  if (!got) return false;
  const digest = createHash("sha256").update(opts.rawBody).digest("base64");
  const parts = [
    `Client-Id:${opts.clientId?.trim() || DOKU_CLIENT_ID}`,
    `Request-Id:${opts.requestId}`,
    `Request-Timestamp:${opts.timestamp}`,
    `Request-Target:${opts.target.startsWith("/") ? opts.target : `/${opts.target}`}`,
    `Digest:${digest}`,
  ];
  const expected = `HMACSHA256=${createHmac("sha256", DOKU_CLIENT_SECRET)
    .update(parts.join("\n"))
    .digest("base64")}`;
  return expected.length === got.length && expected === got;
}

/** Label lingkungan untuk UI */
export function dokuEnvironmentLabel(): string {
  return DOKU_IS_PRODUCTION ? "DOKU Produksi" : "DOKU Sandbox";
}

/** true bila jalur aktif adalah DOKU Checkout (halaman bayar, bukan QR string) */
export function isDokuCheckoutPath(): boolean {
  return !DOKU_SNAP_READY && DOKU_CHECKOUT_READY;
}
