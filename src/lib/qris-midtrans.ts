/**
 * Penyedia QRIS via MIDTRANS — Core API v2 (https://api.sandbox.midtrans.com /
 * https://api.midtrans.com).
 *
 * Alur (sesuai kebijakan toko — pelunasan HANYA oleh sistem):
 *   1. Buat transaksi QRIS dinamis  : POST /v2/charge (payment_type "qris")
 *      -> Midtrans mengembalikan `qr_string` (payload EMVCo QRIS Indonesia)
 *         yang discan pelanggan pakai dompet digital apa pun
 *         (GoPay / OVO / DANA / ShopeePay / m-Banking).
 *   2. Verifikasi dana              : GET /v2/{transaction_id}/status
 *      -> "settlement"/"capture" = PAID (sistem melunaskan pesanan),
 *         "pending" = menunggu, "expire"/"cancel"/"deny" = EXPIRED.
 *   3. Notifikasi webhook (opsional): POST /api/webhooks/qris diverifikasi
 *      dengan signature sha512(order_id+status_code+gross_amount+serverKey)
 *      — lihat verifyMidtransSignature() di bawah.
 *
 * Autentikasi: HTTP Basic, username = SERVER KEY, password kosong
 * (Authorization: Basic base64(serverKey + ":")).
 *
 * trxId yang disimpan di Order.qrisTrxId = Midtrans `transaction_id`
 * (status bisa ditanyakan memakai transaction_id ATAU order_id).
 *
 * Sandbox: QR yang dihasilkan Midtrans mengarah ke simulator uji
 * (https://simulator.sandbox.midtrans.com/...) — dompet digital sungguhan
 * TIDAK bisa membayar; gunakan tautan simulator yang ditampilkan layar
 * pembayaran. Mode produksi (MIDTRANS_IS_PRODUCTION=true) memakai QR nyata.
 */
import { createHash } from "crypto";
import {
  MIDTRANS_API_BASE,
  MIDTRANS_ENABLED,
  MIDTRANS_IS_PRODUCTION,
  MIDTRANS_SERVER_KEY,
  MIDTRANS_SIGNATURE_SECRET,
} from "@/lib/qris-config";
import {
  QrisGatewayError,
  type GatewayStatus,
  type GatewayTransaction,
  normalizeGatewayStatus as normalizeProviderStatus,
} from "@/lib/qris-provider";

/** Masa berlaku QRIS dinamis yang diminta ke Midtrans (menit) — 5 menit */
const QRIS_EXPIRY_MINUTES = 5;

/**
 * Midtrans order_id: hanya alfanumerik + "-_~", maks 50 karakter.
 * Referensi (kode pesanan) umumnya sudah berawalan "AGSI-" — jangan
 * gandakan prefix agar kode pesanan mudah ditelusuri balik dari notifikasi.
 */
function sanitizeOrderId(reference: string): string {
  const raw = reference.startsWith("AGSI-") ? reference : `AGSI-${reference}`;
  return raw.replace(/[^A-Za-z0-9-_~]/g, "-").slice(0, 50);
}

/** Header autentikasi Midtrans */
function authHeaders(): Record<string, string> {
  if (!MIDTRANS_ENABLED) {
    throw new QrisGatewayError("Kunci server Midtrans belum dikonfigurasi di .env");
  }
  const basic = Buffer.from(`${MIDTRANS_SERVER_KEY.trim()}:`).toString("base64");
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Basic ${basic}`,
  };
}

/** fetch ke API Midtrans dengan timeout; JSON diurai apa pun statusnya */
async function midtransFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const { timeoutMs = 12_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${MIDTRANS_API_BASE}${path}`, {
      ...rest,
      headers: { ...authHeaders(), ...(rest.headers ?? {}) },
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { httpStatus: res.status, body };
  } catch (err) {
    if (err instanceof QrisGatewayError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new QrisGatewayError("Midtrans tidak merespons (timeout).");
    }
    throw new QrisGatewayError(
      "Tidak dapat menghubungi Midtrans. Periksa koneksi internet server."
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Ambil pesan galat terbaca dari respons Midtrans */
function messageOf(body: Record<string, unknown>, httpStatus: number): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
  };
  push(body.status_message);
  push(body.error_messages);
  if (Array.isArray(body.error_messages)) body.error_messages.forEach(push);
  const msg = parts.join(" — ");
  return msg || `Midtrans menolak permintaan (HTTP ${httpStatus}).`;
}

/** true bila pesan galat menandakan order_id sudah pernah dipakai */
function isDuplicateOrderError(body: Record<string, unknown>): boolean {
  const s = messageOf(body, 0).toLowerCase();
  return (
    s.includes("already exist") ||
    s.includes("duplicate") ||
    s.includes("sudah pernah") ||
    s.includes("has already been")
  );
}

/**
 * POST /v2/charge — buat transaksi QRIS dinamis (acquirer GoPay, standar
 * QRIS nasional sehingga bisa dibayar semua dompet digital / m-banking).
 * Bila order_id sudah pernah dipakai, dicoba SEKALI lagi dengan suffix unik.
 */
export async function createQrisMidtransPayment(opts: {
  amount: number;
  reference: string;
}): Promise<GatewayTransaction> {
  const amount = Math.round(Number(opts.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new QrisGatewayError("Nominal QRIS harus angka lebih dari 0.");
  }

  const buildBody = (orderId: string) =>
    JSON.stringify({
      payment_type: "qris",
      transaction_details: { order_id: orderId, gross_amount: amount },
      qris: { acquirer: "gopay" },
      custom_expiry: { expiry_duration: QRIS_EXPIRY_MINUTES, unit: "minute" },
    });

  let orderId = sanitizeOrderId(opts.reference);
  let { httpStatus, body } = await midtransFetch("/v2/charge", {
    method: "POST",
    body: buildBody(orderId),
  });

  // Order_id bentrok (transaksi lama masih tercatat) -> coba suffix unik
  if (httpStatus >= 400 && isDuplicateOrderError(body)) {
    orderId = `${orderId.slice(0, 40)}-${Date.now().toString(36)}`;
    ({ httpStatus, body } = await midtransFetch("/v2/charge", {
      method: "POST",
      body: buildBody(orderId),
    }));
  }

  const statusCode = String(body.status_code ?? "");
  const success = httpStatus < 300 && (statusCode === "201" || statusCode === "200");
  if (!success) {
    const status = httpStatus === 401 ? 401 : undefined;
    throw new QrisGatewayError(
      httpStatus === 401
        ? "Kunci server Midtrans ditolak (401). Periksa MIDTRANS_SERVER_KEY di .env."
        : messageOf(body, httpStatus),
      status
    );
  }

  const trxId = typeof body.transaction_id === "string" ? body.transaction_id : "";
  if (!trxId) {
    throw new QrisGatewayError("Midtrans tidak mengembalikan ID transaksi.");
  }
  const qrString =
    typeof body.qr_string === "string" && body.qr_string.trim()
      ? body.qr_string.trim()
      : undefined;

  // expiry_time Midtrans berformat "yyyy-MM-dd HH:mm:ss" (tanpa zona) —
  // tidak bisa diandalkan lintas zona waktu, jadi dihitung juga dari now+5m.
  const parsedExpiry = typeof body.expiry_time === "string" ? Date.parse(body.expiry_time) : NaN;
  const expiresAt = Number.isFinite(parsedExpiry)
    ? new Date(parsedExpiry).toISOString()
    : new Date(Date.now() + QRIS_EXPIRY_MINUTES * 60_000).toISOString();

  return { trxId, qrString, expiresAt };
}

/**
 * POST /v2/{order_id|transaction_id}/cancel — batalkan transaksi QRIS yang
 * masih PENDING di Midtrans (mis. pelanggan tidak jadi bayar & admin mau
 * membatalkan lebih awal tanpa menunggu kedaluwarsa).
 *
 * Hasil aman (boleh dibatalkan lokal):
 *   - HTTP 2xx          -> Midtrans membatalkan transaksi.
 *   - status expire/cancel/deny ATAU pesannya menyebutnya -> sudah mati sendiri.
 *   - HTTP 404          -> transaksi tidak dikenal lagi (sudah dibersihkan).
 * TIDAK aman: transaksi sudah settlement/capture — dana mungkin baru saja
 * masuk; pemanggil WAJIB membiarkan polling/webhook menyelesaikan pelunasan.
 */
export async function cancelQrisMidtransPayment(
  trxId: string
): Promise<{ cancelled: boolean; alreadyPaid: boolean; providerStatus: string | null }> {
  const { httpStatus, body } = await midtransFetch(
    `/v2/${encodeURIComponent(trxId)}/cancel`,
    { method: "POST", timeoutMs: 10_000 }
  );
  const ts = String(body.transaction_status ?? "").toLowerCase();
  const isDead =
    ts === "expire" || ts === "cancel" || ts === "cancelation" || ts === "deny";
  const msg = messageOf(body, httpStatus).toLowerCase();

  if (httpStatus < 300) {
    return { cancelled: true, alreadyPaid: false, providerStatus: ts || null };
  }
  if (httpStatus === 404 || String(body.status_code ?? "") === "404") {
    return { cancelled: true, alreadyPaid: false, providerStatus: "not_found" };
  }
  if (
    ts === "settlement" ||
    ts === "capture" ||
    msg.includes("paid") ||
    msg.includes("settled") ||
    msg.includes("success")
  ) {
    return { cancelled: false, alreadyPaid: true, providerStatus: ts || null };
  }
  if (isDead || msg.includes("cancel") || msg.includes("expire")) {
    return { cancelled: true, alreadyPaid: false, providerStatus: ts || null };
  }
  throw new QrisGatewayError(messageOf(body, httpStatus));
}

/** Status transaksi Midtrans -> status baku aplikasi (PAID/PENDING/EXPIRED) */
export async function getQrisMidtransStatus(trxId: string): Promise<GatewayStatus> {
  const { httpStatus, body } = await midtransFetch(
    `/v2/${encodeURIComponent(trxId)}/status`,
    { timeoutMs: 8_000 }
  );

  // 404 -> transaksi tidak dikenal (dihapus/kedaluwarsa di penyedia):
  // route status akan mengosongkan cache QRIS pesanan dan membuat kode baru.
  if (httpStatus === 404 || String(body.status_code ?? "") === "404") {
    throw new QrisGatewayError("Transaksi tidak ditemukan di Midtrans.", 404);
  }
  if (httpStatus >= 400) {
    throw new QrisGatewayError(messageOf(body, httpStatus));
  }

  return normalizeMidtransStatus(body.transaction_status, body.fraud_status);
}

/** Pemetaan transaction_status (+fraud_status) Midtrans */
export function normalizeMidtransStatus(
  transactionStatus: unknown,
  fraudStatus?: unknown
): GatewayStatus {
  const fraud = String(fraudStatus ?? "").toLowerCase();
  if (fraud === "challenge") return "PENDING"; // menunggu keputusan (bukan QRIS biasa)
  return normalizeProviderStatus(transactionStatus);
}

/**
 * Verifikasi signature HTTP NOTIFICATION Midtrans (webhook):
 * sha512(order_id + status_code + gross_amount + rahasia) == signature_key.
 *
 * Rahasia dicoba bergantian dari daftar kandidat (keduanya rahasia sisi
 * server, jadi mencoba keduanya aman):
 *   1. MIDTRANS_SIGNATURE_SECRET — "Signature Secret Key" dari dashboard
 *      (beberapa dashboard Midtrans menampilkannya terpisah).
 *   2. MIDTRANS_SERVER_KEY       — server key aktif (rumus resmi Midtrans:
 *      signature memakai ServerKey; inilah kandidat baku).
 * Tanpa kecocokan dengan salah satu kandidat, notifikasi HARUS ditolak
 * (bisa forged).
 */
export function verifyMidtransSignature(opts: {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  signatureKey: string;
}): boolean {
  if (!MIDTRANS_ENABLED) return false;
  const secrets = [...new Set([MIDTRANS_SIGNATURE_SECRET, MIDTRANS_SERVER_KEY])].filter(
    (s) => s.length > 0
  );
  const got = opts.signatureKey.trim().toLowerCase();
  for (const secret of secrets) {
    const expected = createHash("sha512")
      .update(`${opts.orderId}${opts.statusCode}${opts.grossAmount}${secret}`)
      .digest("hex");
    if (got.length !== expected.length) continue;
    if (cryptoTimingSafeEqual(got, expected)) return true;
  }
  return false;
}

/** perbandingan konstan-waktu sederhana (hex) */
function cryptoTimingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Catatan lingkungan — dipakai UI untuk label "Sandbox"/"Produksi" */
export function midtransEnvironmentLabel(): string {
  return MIDTRANS_IS_PRODUCTION ? "Midtrans Produksi" : "Midtrans Sandbox";
}
