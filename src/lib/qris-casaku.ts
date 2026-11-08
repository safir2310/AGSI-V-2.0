/**
 * Penyedia QRIS via CASAKU — REST API (https://api.casaku.id).
 *
 * Alur (sesuai kebijakan toko — pelunasan HANYA oleh sistem):
 *   1. Buat transaksi QRIS  : POST /api/generate/v2/qris
 *      -> Casaku mengembalikan transactionId (berawalan "CSK-") +
 *         qr_string (QR berisi nominal melekat / + kode unik) yang
 *         discan pelanggan pakai dompet digital apa pun.
 *   2. Verifikasi dana      : POST /api/generate/check-status
 *      -> "paid" = PAID (sistem melunaskan pesanan),
 *         "pending" = menunggu, "cancel"/"expired" = EXPIRED.
 *         Verifikasi utama Casaku adalah notifikasi dana masuk yang
 *         dibaca aplikasi listener Android milik pemilik toko.
 *   3. Webhook real-time    : POST /api/webhooks/casaku diverifikasi dengan
 *      HMAC-SHA256(raw body, CASAKU_WEBHOOK_SECRET) di header
 *      x-casaku-signature — lihat route webhook.
 *
 * Autentikasi semua endpoint: header x-license-key: CASAKU_LICENSE_KEY.
 *
 * Catatan kode unik (useUniqueCode): Casaku menyematkan kode acak 1–999
 * ke nominal supaya setiap transaksi bernilai UNIK — notifikasi dana
 * masuk dicocokkan ke transaksi yang tepat. Nominal final yang harus
 * dibayar pelanggan dikembalikan lewat GatewayTransaction.finalAmount.
 *
 * trxId yang disimpan di Order.qrisTrxId = Casaku "transactionId"
 * (berawalan "CSK-", contoh: CSK-c39e25d2-0cb2-4a00-9941-863863486df8).
 */
import {
  CASAKU_API_BASE,
  CASAKU_ENABLED,
  CASAKU_LICENSE_KEY,
  CASAKU_PACKAGE_IDS,
  CASAKU_QR_ID,
  CASAKU_TRX_PREFIX,
  CASAKU_USE_UNIQUE_CODE,
} from "@/lib/qris-config";
import {
  QrisGatewayError,
  type GatewayStatus,
  type GatewayTransaction,
} from "@/lib/qris-provider";

/** Masa berlaku QRIS yang diminta ke Casaku (menit) — 5 menit (kebijakan toko) */
const QRIS_EXPIRY_MINUTES = 5;

/** true bila trxId tercatat sebagai transaksi Casaku (prefix "CSK-") */
export function isCasakuTrx(trxId: string): boolean {
  return trxId.startsWith(`${CASAKU_TRX_PREFIX}-`);
}

/** Header autentikasi Casaku */
function casakuHeaders(): Record<string, string> {
  if (!CASAKU_LICENSE_KEY) {
    throw new QrisGatewayError("License Key Casaku belum dikonfigurasi di .env (CASAKU_LICENSE_KEY).");
  }
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-license-key": CASAKU_LICENSE_KEY,
  };
}

/** fetch ke API Casaku dengan timeout; JSON diurai apa pun statusnya */
async function casakuFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const { timeoutMs = 12_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${CASAKU_API_BASE}${path}`, {
      ...rest,
      headers: { ...casakuHeaders(), ...(rest.headers ?? {}) },
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { httpStatus: res.status, body };
  } catch (err) {
    if (err instanceof QrisGatewayError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new QrisGatewayError("Casaku tidak merespons (timeout).");
    }
    throw new QrisGatewayError(
      "Tidak dapat menghubungi Casaku. Periksa koneksi internet server."
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Ambil pesan galat terbaca dari respons Casaku */
function messageOf(body: Record<string, unknown>, httpStatus: number): string {
  const raw =
    (typeof body.message === "string" && body.message) ||
    (typeof body.error === "string" && body.error) ||
    "";
  return raw.trim() || `Casaku menolak permintaan (HTTP ${httpStatus}).`;
}

/** Casaku menjawab 403 "Silakan langganan" bila akun belum VIP aktif */
function isSubscriptionRequired(httpStatus: number, body: Record<string, unknown>): boolean {
  if (httpStatus !== 403) return false;
  const msg = messageOf(body, httpStatus).toLowerCase();
  return msg.includes("langganan") || msg.includes("pricing") || msg.includes("berlangganan");
}

/** Ambil nested object "data" bila ada */
function dataOf(body: Record<string, unknown>): Record<string, unknown> {
  const d = body.data;
  return d && typeof d === "object" && !Array.isArray(d)
    ? (d as Record<string, unknown>)
    : body;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

/**
 * POST /api/generate/v2/qris — buat transaksi QRIS via Casaku.
 * QR berasal dari QRIS statis toko yang di-upload ke dashboard Casaku;
 * nominal (termasuk kode unik bila aktif) melekat di transaksi.
 */
export async function createCasakuQrisPayment(opts: {
  amount: number;
  reference: string;
}): Promise<GatewayTransaction> {
  if (!CASAKU_ENABLED) {
    throw new QrisGatewayError(
      "Casaku belum terkonfigurasi lengkap (CASAKU_LICENSE_KEY + CASAKU_QR_ID di .env)."
    );
  }
  const amount = Math.round(Number(opts.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new QrisGatewayError("Nominal QRIS harus angka lebih dari 0.");
  }

  const { httpStatus, body } = await casakuFetch("/api/generate/v2/qris", {
    method: "POST",
    body: JSON.stringify({
      qr_id: CASAKU_QR_ID,
      amount,
      useUniqueCode: CASAKU_USE_UNIQUE_CODE,
      packageIds: CASAKU_PACKAGE_IDS,
      expiredInMinutes: QRIS_EXPIRY_MINUTES,
      qrType: "dynamic",
      paymentMethod: "qris",
      useQris: true,
      prefix: CASAKU_TRX_PREFIX,
    }),
  });

  if (httpStatus >= 400) {
    if (isSubscriptionRequired(httpStatus, body)) {
      throw new QrisGatewayError(
        "Akun Casaku belum berlangganan aktif (403) — aktivasi paket di casaku.id/pricing agar API QRIS aktif.",
        403
      );
    }
    if (httpStatus === 401) {
      throw new QrisGatewayError(
        "License Key Casaku ditolak (401). Periksa CASAKU_LICENSE_KEY di .env.",
        401
      );
    }
    throw new QrisGatewayError(messageOf(body, httpStatus), httpStatus);
  }

  const data = dataOf(body);
  const trxId = pickString(data, ["transactionId", "transaction_id", "trxId", "id"]);
  if (!trxId) {
    throw new QrisGatewayError("Casaku tidak mengembalikan ID transaksi.");
  }
  const qrString = pickString(data, [
    "qr_string",
    "qrString",
    "qrContent",
    "qr_content",
    "payload",
    "qr",
  ]);
  if (!qrString) {
    throw new QrisGatewayError("Casaku tidak mengembalikan kode QR (qr_string).");
  }

  // Nominal final yang harus dibayar pelanggan (total + kode unik bila aktif)
  const finalAmount = pickNumber(data, [
    "amount",
    "finalAmount",
    "final_amount",
    "totalAmount",
    "total_amount",
    "nominal",
  ]);
  const uniqueCode = pickNumber(data, ["uniqueCode", "unique_code", "kodeUnik", "kode_unik"]);

  // Kedaluwarsa transaksi — Casaku mengembalikan ISO/teks tanggal; kalau
  // tidak ada, hitung dari sekarang + 5 menit (kebijakan toko).
  const expiresRaw = pickString(data, [
    "expiredAt",
    "expired_at",
    "expiresAt",
    "expires_at",
    "expiryDate",
    "expiry_date",
  ]);
  const parsedExpiry = expiresRaw ? Date.parse(expiresRaw) : NaN;
  const expiresAt = Number.isFinite(parsedExpiry)
    ? new Date(parsedExpiry).toISOString()
    : new Date(Date.now() + QRIS_EXPIRY_MINUTES * 60_000).toISOString();

  return {
    trxId,
    qrString,
    expiresAt,
    finalAmount: finalAmount && finalAmount > 0 ? finalAmount : undefined,
    uniqueCode,
  };
}

/**
 * POST /api/generate/check-status — tanyakan Casaku: sudah masuk belum dananya?
 * Status Casaku: "pending" | "paid" | "cancel" | "expired".
 */
export async function getCasakuStatus(trxId: string): Promise<GatewayStatus> {
  const { httpStatus, body } = await casakuFetch("/api/generate/check-status", {
    method: "POST",
    body: JSON.stringify({ transactionId: trxId }),
    timeoutMs: 8_000,
  });

  if (httpStatus >= 400) {
    if (httpStatus === 404 || String(body.status ?? "") === "404") {
      throw new QrisGatewayError("Transaksi tidak ditemukan di Casaku.", 404);
    }
    throw new QrisGatewayError(messageOf(body, httpStatus), httpStatus);
  }
  const data = dataOf(body);
  const raw = data.status ?? body.status;
  const s = String(raw ?? "").toLowerCase();
  if (s === "paid") return "PAID";
  if (s === "pending") return "PENDING";
  if (s === "cancel" || s === "expired" || s === "expire") return "EXPIRED";
  return "UNKNOWN";
}

/**
 * POST /api/generate/cancel-status — batalkan transaksi Casaku yang masih
 * PENDING (mis. pesanan dibatalkan lebih awal). Bila transasi ternyata
 * sudah lunas, pemanggil WAJIB membiarkan polling/webhook melunaskan pesanan.
 */
export async function cancelCasakuPayment(
  trxId: string
): Promise<{ cancelled: boolean; alreadyPaid: boolean; providerStatus: string | null }> {
  const { httpStatus, body } = await casakuFetch("/api/generate/cancel-status", {
    method: "POST",
    body: JSON.stringify({ transactionId: trxId }),
    timeoutMs: 10_000,
  });
  const data = dataOf(body);
  const st = String(data.status ?? body.status ?? "").toLowerCase();

  if (httpStatus < 300) {
    return { cancelled: st === "cancel" || st === "expired" || st === "", alreadyPaid: false, providerStatus: st || null };
  }
  if (httpStatus === 404 || String(body.status ?? "") === "404") {
    return { cancelled: true, alreadyPaid: false, providerStatus: "not_found" };
  }
  if (st === "paid") {
    return { cancelled: false, alreadyPaid: true, providerStatus: st };
  }
  throw new QrisGatewayError(messageOf(body, httpStatus), httpStatus);
}

/**
 * GET /api/device/check — apakah HP Android pemilik (aplikasi listener
 * Casaku) sedang ONLINE? Verifikasi dana hanya bisa berjalan bila
 * listener aktif. Dipakai health-check admin.
 */
export async function casakuDeviceCheck(): Promise<{
  ok: boolean;
  online: boolean;
  httpStatus: number;
  detail: string;
}> {
  try {
    const { httpStatus, body } = await casakuFetch("/api/device/check", {
      timeoutMs: 8_000,
    });
    if (httpStatus >= 400) {
      const msg = messageOf(body, httpStatus);
      return {
        ok: false,
        online: false,
        httpStatus,
        detail: isSubscriptionRequired(httpStatus, body)
          ? `Akun Casaku belum berlangganan aktif — aktivasi di casaku.id/pricing (${msg})`
          : msg,
      };
    }
    const data = dataOf(body);
    // Bentuk respons device check tidak terdokumentasi lengkap — terima
    // beberapa kemungkinan penamaan; default dianggap online bila 2xx.
    const onlineRaw = String(
      data.online ?? data.isOnline ?? data.status ?? body.online ?? body.status ?? ""
    ).toLowerCase();
    const online = onlineRaw === "" ? true : ["true", "online", "aktif", "active", "1"].includes(onlineRaw);
    return {
      ok: true,
      online,
      httpStatus,
      detail: online
        ? "Perangkat listener Casaku ONLINE — verifikasi otomatis siap."
        : "Perangkat listener Casaku OFFLINE — nyalakan aplikasi Casaku di HP Android & pastikan internet aktif.",
    };
  } catch (err) {
    return {
      ok: false,
      online: false,
      httpStatus: 0,
      detail: err instanceof Error ? err.message : "Casaku tidak dapat dihubungi.",
    };
  }
}
