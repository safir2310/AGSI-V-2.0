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
  QrisGatewayError,
  type GatewayStatus,
  type GatewayTransaction,
} from "@/lib/qris-provider";

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
//  API ADAPTER — dipakai qris-gateway.ts & webhook
// ============================================================

/**
 * Buat transaksi QRIS dinamis DOKU.
 * trxId yang disimpan di Order.qrisTrxId = "DOKU-<kode pesanan>" — dipakai
 * juga sebagai partnerReferenceNo / invoice number di DOKU.
 */
export async function createQrisDokuPayment(opts: {
  amount: number;
  reference: string;
}): Promise<GatewayTransaction> {
  const amount = Math.round(Number(opts.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new QrisGatewayError("Nominal QRIS harus angka lebih dari 0.");
  }
  const partnerReferenceNo = partnerReferenceNoOf(opts.reference);
  const validityPeriod = wibTimestamp(
    new Date(Date.now() + DOKU_QRIS_EXPIRY_MINUTES * 60_000)
  );

  const qrString = DOKU_SNAP_READY
    ? await snapGenerateQris({ partnerReferenceNo, amount, validityPeriod })
    : await mcpCreateQris({ partnerReferenceNo, amount, validityPeriod });

  return {
    trxId: partnerReferenceNo,
    qrString,
    expiresAt: new Date(Date.now() + DOKU_QRIS_EXPIRY_MINUTES * 60_000).toISOString(),
  };
}

/**
 * Cek status transaksi DOKU.
 * Jalur SNAP: transaksi tak dikenal (404) -> lempar 404 agar layar bayar
 * membuat kode baru. Jalur MCP (pencarian laporan): hasil kosong = belum ada
 * catatan -> PENDING (QR tetap; jangan regenerasi tiap poll).
 */
export async function getQrisDokuStatus(trxId: string): Promise<GatewayStatus> {
  if (DOKU_SNAP_READY) {
    return snapQueryStatus(partnerReferenceNoOf(trxId));
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
    return { cancelled: false, alreadyPaid: false, providerStatus: "mcp_no_cancel_tool" };
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

/** Label lingkungan untuk UI */
export function dokuEnvironmentLabel(): string {
  return DOKU_IS_PRODUCTION ? "DOKU Produksi" : "DOKU Sandbox";
}
