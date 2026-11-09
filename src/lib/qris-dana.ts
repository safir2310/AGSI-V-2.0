/**
 * Penyedia QRIS via DANA ENTERPRISE — QRIS (Acquirer) MPM resmi.
 *
 * Ini integrasi yang mengalirkan dana LANGSUNG ke saldo akun DANA merchant
 * pemilik toko: DANA menjadi acquirer QRIS (bukan perantara seperti gateway
 * lain). QRIS dinamis yang dihasilkan tetap QRIS nasional standar EMVCo —
 * bisa dibayar dari DANA, GoPay, OVO, ShopeePay, dan m-Banking mana pun.
 *
 * Alur (sesuai kebijakan toko — pelunasan HANYA oleh sistem):
 *   1. Buat QRIS dinamis     : POST /v1.0/qr/qr-mpm-generate.htm
 *      -> DANA mengembalikan `qrContent` (payload QRIS MPM) untuk discan
 *         pelanggan. Nominal & masa berlaku melekat pada kode.
 *   2. Verifikasi dana       : POST /rest/v1.1/debit/status (serviceCode 47)
 *      -> latestTransactionStatus "00" = dana MASUK (sistem melunaskan
 *         pesanan), "01"/"02"/"03" = menunggu, "05" = dibatalkan/kedaluwarsa,
 *         "07" = tidak ditemukan (layar membuat kode bayar baru).
 *   3. Notifikasi webhook    : DANA memanggil /api/webhooks/qris (Finish
 *      Notify) — signature X-SIGNATURE DIVERIFIKASI dengan PUBLIC KEY DANA
 *      sebelum notifikasi dipercaya (fail-closed).
 *   4. Batalkan transaksi    : POST /v1.0/debit/cancel.htm (void pending).
 *
 * Signature SNAP (dokumen resmi DANA "Authentication Asymmetric SNAP"):
 *   stringToSign = "POST:<relative-path>:<sha256hex(body-minified)>:<X-TIMESTAMP>"
 *   X-SIGNATURE  = base64( SHA256withRSA( private_key, stringToSign ) )
 *   X-TIMESTAMP  = waktu JAKARTA (GMT+7): YYYY-MM-DDTHH:mm:ss+07:00
 *
 * trxId tersimpan di Order.qrisTrxId = partnerReferenceNo yang dikirim
 * (berawalan "DANA-", maks 25 karakter sesuai batas SNAP QRIS).
 *
 * Base URL: sandbox https://api.sandbox.dana.id — produksi https://api.saas.dana.id
 * (deteksi otomatis: base URL tanpa kata "sandbox" = PRODUKSI — uang nyata).
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign as rsaSign,
  verify as rsaVerify,
} from "crypto";
import type { KeyObject } from "crypto";
import {
  DANA_API_BASE,
  DANA_CHANNEL_ID,
  DANA_CLIENT_ID,
  DANA_ENABLED,
  DANA_IS_PRODUCTION,
  DANA_MERCHANT_ID,
  DANA_PRIVATE_KEY,
  DANA_PUBLIC_KEY,
  DANA_QRIS_EXPIRY_MINUTES,
  DANA_STORE_ID,
  DANA_TERMINAL_ID,
} from "@/lib/qris-config";
import {
  QrisGatewayError,
  type GatewayStatus,
  type GatewayTransaction,
} from "@/lib/qris-provider";

/** SNAP service code QRIS MPM (Acquirer) — disertakan di Query Payment */
const SERVICE_CODE_QRIS_MPM = "47";

// ============================================================
//  WAKTU & SIGNATURE SNAP
// ============================================================

/**
 * Format waktu SNAP DANA: YYYY-MM-DDTHH:mm:ss+07:00 — SELALU zona Jakarta
 * (GMT+7) apa pun zona server. Trik locale "sv-SE" memberi "2026-11-09 14:23:45".
 */
function danaTimestamp(d: Date = new Date()): string {
  const jakarta = d.toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" });
  return `${jakarta.replace(" ", "T")}+07:00`;
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * StringToSign SNAP untuk API transaksional:
 *   POST:<relative-path>:<sha256hex(minifiedBody)>:<X-TIMESTAMP>
 */
function stringToSign(path: string, body: string, timestamp: string): string {
  return `POST:${path}:${sha256Hex(body)}:${timestamp}`;
}

/** Private key milik toko sebagai KeyObject (lempar galat terbaca bila rusak) */
function merchantPrivateKey(): KeyObject {
  try {
    return createPrivateKey(DANA_PRIVATE_KEY);
  } catch {
    throw new QrisGatewayError(
      "DANA_PRIVATE_KEY tidak dapat dibaca — pastikan PEM (PKCS#8) utuh, " +
        "termasuk baris -----BEGIN/END PRIVATE KEY-----."
    );
  }
}

/** Tanda tangani stringToSign -> X-SIGNATURE base64 (SHA256withRSA) */
function signRequest(path: string, body: string, timestamp: string): string {
  const sts = stringToSign(path, body, timestamp);
  return rsaSign("sha256", Buffer.from(sts, "utf8"), merchantPrivateKey()).toString("base64");
}

/**
 * Verifikasi signature webhook DANA (Finish Notify) dengan PUBLIC KEY DANA.
 * DANA menyusun stringToSign yang sama; dikatakan valid bila cocok untuk
 * salah satu kandidat path (pathname persis, atau dengan query bila ada).
 */
export function verifyDanaWebhookSignature(opts: {
  signature: string;
  timestamp: string;
  rawBody: string;
  paths: string[];
}): boolean {
  if (!DANA_PUBLIC_KEY) return false;
  try {
    const pub = createPublicKey(DANA_PUBLIC_KEY);
    const sig = Buffer.from(opts.signature, "base64");
    for (const path of opts.paths) {
      const sts = stringToSign(path, opts.rawBody, opts.timestamp);
      if (rsaVerify("sha256", Buffer.from(sts, "utf8"), pub, sig)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ============================================================
//  HTTP CLIENT DANA
// ============================================================

type DanaResponse = {
  httpStatus: number;
  body: Record<string, unknown>;
  raw: string;
};

/** Header SNAP lengkap + X-SIGNATURE untuk body PERSIS yang dikirim */
function danaHeaders(path: string, body: string): Record<string, string> {
  if (!DANA_ENABLED) {
    throw new QrisGatewayError("Kredensial DANA belum dikonfigurasi di .env");
  }
  const timestamp = danaTimestamp();
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-TIMESTAMP": timestamp,
    "X-SIGNATURE": signRequest(path, body, timestamp),
    ORIGIN: (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "agsi-pos").replace(
      /^https?:\/\//,
      ""
    ),
    "X-PARTNER-ID": DANA_CLIENT_ID,
    "X-EXTERNAL-ID": randomUUID(),
    "CHANNEL-ID": DANA_CHANNEL_ID,
  };
}

/** fetch POST ke API DANA — body JSON minified yang PERSIS di-hash untuk signature */
async function danaFetch(
  path: string,
  bodyObj: Record<string, unknown>,
  timeoutMs = 12_000
): Promise<DanaResponse> {
  const body = JSON.stringify(bodyObj);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${DANA_API_BASE}${path}`, {
      method: "POST",
      headers: danaHeaders(path, body),
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Respons bukan JSON — diteruskan mentah lewat `raw`
    }
    return { httpStatus: res.status, body: parsed, raw };
  } catch (err) {
    if (err instanceof QrisGatewayError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new QrisGatewayError("API DANA tidak merespons (timeout).");
    }
    throw new QrisGatewayError(
      "Tidak dapat menghubungi API DANA. Periksa koneksi internet server."
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Pesan galat terbaca dari respons DANA */
function danaMessage(r: DanaResponse): string {
  const parts: string[] = [];
  for (const key of ["responseMessage", "responseDescription", "errorMessage", "error"]) {
    const v = r.body[key];
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
  }
  const msg = parts.join(" — ");
  return msg || `API DANA menolak permintaan (HTTP ${r.httpStatus}).`;
}

/** Respons DANA gagal? (HTTP error ATAU envelope SNAP non-2xx) */
function isFail(r: DanaResponse): boolean {
  const code = String(r.body.responseCode ?? "");
  if (r.httpStatus >= 400) return true;
  return code.length > 0 && !code.startsWith("2");
}

/** Pesan menandakan partnerReferenceNo sudah pernah dipakai? */
function isDuplicate(r: DanaResponse): boolean {
  const s = danaMessage(r).toLowerCase();
  const code = String(r.body.responseCode ?? "");
  return (
    s.includes("duplicate") ||
    s.includes("already exist") ||
    s.includes("already been used") ||
    s.includes("sudah pernah") ||
    code === "4018001"
  );
}

function danaError(r: DanaResponse): QrisGatewayError {
  if (r.httpStatus === 401 || r.httpStatus === 403) {
    return new QrisGatewayError(
      "Signature/kredensial DANA ditolak (" +
        r.httpStatus +
        "). Pastikan DANA_CLIENT_ID sesuai portal dan DANA_PRIVATE_KEY " +
        "adalah pasangan public key yang di-upload di portal DANA.",
      r.httpStatus
    );
  }
  return new QrisGatewayError(danaMessage(r));
}

/** Pemetaan latestTransactionStatus SNAP -> status baku aplikasi */
export function normalizeDanaStatus(latest: unknown): GatewayStatus {
  const s = String(latest ?? "").trim();
  if (s === "00") return "PAID"; // Success — dana masuk
  if (s === "01" || s === "02" || s === "03") return "PENDING"; // Initiated/Paying/Pending
  if (s === "05" || s === "06") return "EXPIRED"; // Cancelled/Closed
  return "UNKNOWN"; // "07" not found & lainnya
}

// ============================================================
//  GENERATE QRIS — buat kode QRIS dinamis DANA
// ============================================================

/** trxId transaksi DANA selalu berawalan "DANA-" */
export function isDanaTrx(trxId: string): boolean {
  return trxId.startsWith("DANA-");
}

/**
 * partnerReferenceNo SNAP QRIS: maks 25 karakter, alfanumerik + "-".
 * "AGSI-20261107-2856" -> "DANA-20261107-2856"; retry mendapat suffix pendek
 * yang tetap menjaga total <= 25 karakter.
 */
function buildPartnerReference(reference: string, retrySuffix?: string): string {
  const base = reference.replace(/^AGSI-/, "").replace(/[^A-Za-z0-9-]/g, "-");
  if (!retrySuffix) return `DANA-${base}`.slice(0, 25);
  const sfx = retrySuffix.slice(0, 6);
  const head = `DANA-${base}`.slice(0, 25 - sfx.length - 1);
  return `${head}-${sfx}`;
}

/** Body Generate QRIS sesuai spesifikasi QRIS (Acquirer) MPM */
function buildGenerateBody(ref: string, amount: number): Record<string, unknown> {
  const envInfo: Record<string, unknown> = {
    terminalType: "SYSTEM",
    orderTerminalType: "SYSTEM",
    sourcePlatform: "IPG",
  };
  const body: Record<string, unknown> = {
    partnerReferenceNo: ref,
    amount: { value: amount.toFixed(2), currency: "IDR" },
    validityPeriod: danaTimestamp(new Date(Date.now() + DANA_QRIS_EXPIRY_MINUTES * 60_000)),
    merchantId: DANA_MERCHANT_ID,
    additionalInfo: { terminalSource: "POS", envInfo },
  };
  if (DANA_STORE_ID) body.storeId = DANA_STORE_ID;
  if (DANA_TERMINAL_ID) body.terminalId = DANA_TERMINAL_ID;
  return body;
}

export async function createQrisDanaPayment(opts: {
  amount: number;
  reference: string;
}): Promise<GatewayTransaction> {
  if (!DANA_ENABLED) {
    throw new QrisGatewayError("Kredensial DANA belum dikonfigurasi di .env");
  }
  const amount = Math.round(Number(opts.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new QrisGatewayError("Nominal QRIS harus angka lebih dari 0.");
  }

  const path = "/v1.0/qr/qr-mpm-generate.htm";
  let ref = buildPartnerReference(opts.reference);
  let r = await danaFetch(path, buildGenerateBody(ref, amount));

  // partnerReferenceNo bentrok (transaksi lama masih tercatat) -> sekali lagi
  // dengan suffix unik (tetap <= 25 karakter).
  if (isFail(r) && isDuplicate(r)) {
    ref = buildPartnerReference(opts.reference, Date.now().toString(36).slice(-6));
    r = await danaFetch(path, buildGenerateBody(ref, amount));
    if (isFail(r)) throw danaError(r);
  } else if (isFail(r)) {
    throw danaError(r);
  }

  const qrContent =
    typeof r.body.qrContent === "string" && r.body.qrContent.trim()
      ? r.body.qrContent.trim()
      : undefined;
  const qrUrl =
    typeof r.body.qrUrl === "string" && r.body.qrUrl.startsWith("http")
      ? r.body.qrUrl
      : undefined;
  const qrImageBase64 = typeof r.body.qrImage === "string" && r.body.qrImage
    ? r.body.qrImage
    : undefined;

  if (!qrContent && !qrUrl && !qrImageBase64) {
    throw new QrisGatewayError("DANA tidak mengembalikan kode QRIS.");
  }

  return {
    trxId: ref,
    qrString: qrContent,
    imageUrl:
      qrUrl ?? (qrImageBase64 ? `data:image/png;base64,${qrImageBase64}` : undefined),
    expiresAt: new Date(Date.now() + DANA_QRIS_EXPIRY_MINUTES * 60_000).toISOString(),
  };
}

// ============================================================
//  QUERY PAYMENT — verifikasi dana masuk
// ============================================================

export async function getQrisDanaStatus(trxId: string): Promise<GatewayStatus> {
  if (!DANA_ENABLED) {
    throw new QrisGatewayError("Kredensial DANA belum dikonfigurasi di .env");
  }
  const path = "/rest/v1.1/debit/status";
  const bodyObj: Record<string, unknown> = {
    originalPartnerReferenceNo: trxId,
    serviceCode: SERVICE_CODE_QRIS_MPM,
    merchantId: DANA_MERCHANT_ID,
  };
  if (DANA_STORE_ID) bodyObj.externalStoreId = DANA_STORE_ID;

  const r = await danaFetch(path, bodyObj, 8_000);

  // Signature/kredensial ditolak — kredensial bermasalah, jangan perlakukan
  // sebagai "transaksi tidak ada".
  if (r.httpStatus === 401 || r.httpStatus === 403) throw danaError(r);

  const status = normalizeDanaStatus(r.body.latestTransactionStatus);
  if (isFail(r) || status === "UNKNOWN") {
    // "07"/tidak dikenal -> transaksi tidak ada lagi di DANA (kadaluarsa
    // dibersihkan). Route status akan mengosongkan cache & membuat kode baru.
    throw new QrisGatewayError("Transaksi tidak ditemukan di DANA.", 404);
  }
  return status;
}

// ============================================================
//  CANCEL ORDER — batalkan transaksi QRIS pending
// ============================================================

/**
 * POST /v1.0/debit/cancel.htm — batalkan transaksi QRIS yang masih PENDING.
 * Hasil aman (boleh dibatalkan lokal): 2xx / sudah kedaluwarsa / 404.
 * TIDAK aman bila transaksi sudah PAID — pemanggil WAJIB membiarkan
 * polling/webhook menyelesaikan pelunasan.
 */
export async function cancelQrisDanaPayment(trxId: string): Promise<{
  cancelled: boolean;
  alreadyPaid: boolean;
  providerStatus: string | null;
}> {
  const path = "/v1.0/debit/cancel.htm";
  const r = await danaFetch(
    path,
    {
      originalPartnerReferenceNo: trxId,
      merchantId: DANA_MERCHANT_ID,
      reason: "Dibatalkan merchant via AGSI POS",
    },
    10_000
  );

  if (r.httpStatus === 404) {
    return { cancelled: true, alreadyPaid: false, providerStatus: "not_found" };
  }
  const status = normalizeDanaStatus(r.body.latestTransactionStatus);
  const msg = danaMessage(r).toLowerCase();
  if (!isFail(r)) {
    return { cancelled: true, alreadyPaid: false, providerStatus: "cancelled" };
  }
  if (status === "PAID" || msg.includes("paid") || msg.includes("success")) {
    return { cancelled: false, alreadyPaid: true, providerStatus: "paid" };
  }
  if (
    status === "EXPIRED" ||
    msg.includes("cancel") ||
    msg.includes("close") ||
    msg.includes("expire")
  ) {
    return { cancelled: true, alreadyPaid: false, providerStatus: "closed" };
  }
  throw new QrisGatewayError(danaMessage(r));
}

/** Catatan lingkungan — dipakai UI untuk label "Sandbox"/"Produksi" */
export function danaEnvironmentLabel(): string {
  return DANA_IS_PRODUCTION ? "DANA Produksi" : "DANA Sandbox";
}
