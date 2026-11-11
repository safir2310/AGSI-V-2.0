/**
 * Gateway QRIS — jembatan ke penyedia pembayaran QRIS.
 *
 * Prinsip penting (kebijakan pemilik toko):
 *   Pesanan QRIS hanya boleh dilunaskan OLEH SISTEM, yaitu saat penyedia
 *   pembayaran mengonfirmasi dana BENAR-BENAR MASUK (polling status atau
 *   webhook). Kasir / admin TIDAK PUNYA tombol dan TIDAK BISA menandai
 *   lunas pesanan QRIS lewat API mana pun.
 *
 * Urutan penyedia (lihat qris-config.ts & qris-provider.ts):
 *   -1. DOKU (prioritas utama) — aktif otomatis bila DOKU_API_KEY (jalur MCP)
 *      atau DOKU_CLIENT_ID + DOKU_CLIENT_SECRET + DOKU_MERCHANT_ID (jalur SNAP)
 *      tersedia di .env. QRIS dinamis resmi DOKU (SNAP MPM) — dana masuk ke
 *      merchant DOKU pemilik toko, verifikasi otomatis polling + webhook
 *      (lihat qris-doku.ts).
 *   0. DANA ENTERPRISE — aktif otomatis bila DANA_CLIENT_ID
 *      + DANA_MERCHANT_ID + DANA_PRIVATE_KEY tersedia di .env. QRIS dinamis
 *      resmi dari API DANA (Acquirer MPM) — dana masuk LANGSUNG ke saldo
 *      akun DANA merchant pemilik toko (lihat qris-dana.ts).
 *   1. CASAKU — aktif otomatis bila CASAKU_LICENSE_KEY
 *      + CASAKU_QR_ID tersedia di .env. QRIS statis toko menjadi dinamis:
 *      nominal melekat, verifikasi dana masuk via listener Android
 *      pemilik (webhook real-time + polling status — lihat qris-casaku.ts).
 *   2. MIDTRANS — aktif bila MIDTRANS_SERVER_KEY tersedia di .env.
 *      Transaksi QRIS dinamis dibuat lewat Core API v2 (POST /v2/charge),
 *      verifikasi otomatis lewat polling status + webhook bersignature
 *      (lihat qris-midtrans.ts).
 *   3. GATEWAY BAWAAN (sandbox lokal) — transaksi dibuat/diperiksa langsung
 *      lewat modul qris-sandbox (route /api/qris-gateway/...), diautentikasi
 *      dengan API key pemilik toko.
 *   4. PENYEDIA EKSTERNAL (gaya API qriskuu) — aktif bila QRIS_SANDBOX=false
 *      dan/atau QRIS_GATEWAY_URL eksternal diset:
 *        POST {QRIS_GATEWAY_URL}/payments                -> buat transaksi
 *        GET  {QRIS_GATEWAY_URL}/payments/:trxid/status  -> cek status
 *        Header: X-API-Key: <QRIS_GATEWAY_API_KEY>
 *
 * Semua parsing respons eksternal dibuat toleran (beberapa kemungkinan nama
 * field) agar mudah berpindah penyedia tanpa mengubah kode aplikasi.
 */

import { db } from "@/lib/db";
import { notifyOrderPaid } from "@/lib/push";
import {
  CASAKU_ENABLED,
  DANA_ENABLED,
  DANA_IS_PRODUCTION,
  DOKU_ENABLED,
  DOKU_IS_PRODUCTION,
  MIDTRANS_ENABLED,
  MIDTRANS_IS_PRODUCTION,
  QRIS_GATEWAY_API_KEY,
  QRIS_GATEWAY_URL,
  QRIS_SANDBOX_ENABLED,
} from "@/lib/qris-config";
import {
  cancelQrisDokuPayment,
  createQrisDokuPayment,
  getQrisDokuStatus,
  isDokuTrx,
} from "@/lib/qris-doku";
import {
  createCasakuQrisPayment,
  getCasakuStatus,
  isCasakuTrx,
} from "@/lib/qris-casaku";
import {
  createQrisDanaPayment,
  getQrisDanaStatus,
  isDanaTrx,
} from "@/lib/qris-dana";
import {
  createQrisMidtransPayment,
  getQrisMidtransStatus,
} from "@/lib/qris-midtrans";
import { createSandboxTrx, getSandboxTrx } from "@/lib/qris-sandbox";
import {
  normalizeGatewayStatus,
  QrisGatewayError,
  type GatewayStatus,
  type GatewayTransaction,
} from "@/lib/qris-provider";

export { QRIS_GATEWAY_API_KEY, QRIS_GATEWAY_URL, QRIS_SANDBOX_ENABLED };
export { normalizeGatewayStatus, QrisGatewayError };
export type { GatewayStatus, GatewayTransaction };

/** fetch ke gateway dengan timeout + API key; melempar QrisGatewayError saat gagal */
async function gatewayFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Record<string, unknown>> {
  const { timeoutMs = 8000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${QRIS_GATEWAY_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": QRIS_GATEWAY_API_KEY,
        ...(rest.headers ?? {}),
      },
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const message =
        (typeof body.message === "string" && body.message) ||
        (typeof body.error === "string" && body.error) ||
        `Penyedia QRIS menolak permintaan (HTTP ${res.status}).`;
      throw new QrisGatewayError(message, res.status);
    }
    return body;
  } catch (err) {
    if (err instanceof QrisGatewayError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new QrisGatewayError("Penyedia QRIS tidak merespons (timeout).");
    }
    throw new QrisGatewayError(
      "Tidak dapat menghubungi penyedia QRIS. Periksa koneksi internet server."
    );
  } finally {
    clearTimeout(timer);
  }
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

/** POST /payments — buat transaksi QRIS dinamis dengan nominal melekat */
async function requestCreate(reference: string, amount: number): Promise<GatewayTransaction> {
  const body = await gatewayFetch("/payments", {
    method: "POST",
    body: JSON.stringify({
      amount,
      reference,
      type: "dynamic",
    }),
  });
  const data = dataOf(body);
  const trxId = pickString(data, ["trxid", "trxId", "transactionId", "transaction_id", "id"]);
  if (!trxId) {
    throw new QrisGatewayError("Penyedia QRIS tidak mengembalikan ID transaksi.");
  }
  const qrString = pickString(data, [
    "qrString",
    "qr_string",
    "qrContent",
    "qr_content",
    "payload",
    "qr",
    "qr_string_dynamic",
  ]);
  const maybeImage = pickString(data, ["qrImage", "qr_image", "qrImageUrl", "qr_image_url", "qrUrl", "qr_url"]);
  const imageUrl = maybeImage?.startsWith("http") ? maybeImage : undefined;
  const expiresAt = pickString(data, ["expiresAt", "expires_at", "expiryDate", "expiredAt", "expired_at"]) ?? null;
  if (!qrString && !imageUrl) {
    throw new QrisGatewayError("Penyedia QRIS tidak mengembalikan kode QR.");
  }
  return { trxId, qrString, imageUrl, expiresAt };
}

/**
 * Buat transaksi QRIS dinamis.
 * Casaku: prioritas utama bila terkonfigurasi (QRIS statis toko + listener
 *   Android pemilik; dana masuk langsung ke rekening pemilik, 0% MDR).
 * Midtrans: cadangan bila kunci server tersedia (Core API v2).
 *   Bila Midtrans MENOLAK pembuatan transaksi (mis. akun belum diaktifkan /
 *   edge Midtrans memblokir IP server — lihat MIDTRANS_SETUP.md) dan aplikasi
 *   masih mode sandbox, transaksi dibuat di GATEWAY BAWAAN supaya QRIS tetap
 *   bisa dipakai & diuji dengan verifikasi otomatis. Di mode PRODUKSI tidak
 *   ada fallback senyap — galat Midtrans diteruskan apa adanya.
 * Gateway bawaan: dibuat langsung di database gateway (tanpa HTTP).
 * Penyedia eksternal: bila referensi sudah pernah dipakai (transaksi lama
 * kedaluwarsa lalu dibuat ulang), dicoba sekali lagi dengan referensi unik.
 */
export async function createQrisGatewayPayment(opts: {
  amount: number;
  reference: string;
  /** "EWALLET": halaman bayar DOKU difilter ke kanal e-wallet (DOKU Wallet,
   *  DANA, OVO, ShopeePay, LinkAja + VA DOKU cadangan — sesuai kanal aktif).
   *  "QRIS": pelanggan LANGSUNG diarahkan ke pembayaran QRIS e-wallet DOKU
   *  (kanal "QRIS" — pindai pakai e-wallet/m-Banking apa pun).
   *  Diabaikan penyedia non-DOKU (QRIS tetap QR string biasa). */
  channelMode?: "EWALLET" | "QRIS";
  /** ID pesanan aplikasi — redirect setelah bayar diarahkan ke halaman
   *  IN-APP /pay/<id> (bukan halaman lain). Dipakai jalur DOKU Checkout. */
  callbackRef?: string;
}): Promise<GatewayTransaction> {
  // ==== -1) DOKU — penyedia utama (QRIS SNAP MPM resmi DOKU) ====
  // Dana masuk ke merchant DOKU pemilik toko. Bila DOKU sandbox menolak
  // (kanal QRIS belum aktif / API key terbatas), lanjut ke penyedia
  // berikutnya dan tampilkan alasannya (fallbackReason). Di mode PRODUKSI
  // tidak ada fallback senyap — galat DOKU diteruskan apa adanya.
  let dokuFailure: string | null = null;
  if (DOKU_ENABLED) {
    try {
      const trx = await createQrisDokuPayment(opts);
      return { ...trx, provider: DOKU_IS_PRODUCTION ? "doku" : "doku-sandbox" };
    } catch (err) {
      dokuFailure = err instanceof Error ? err.message : "DOKU tidak dapat dihubungi.";
      console.warn("[QRIS] DOKU menolak charge — lanjut penyedia berikutnya:", dokuFailure);
      if (DOKU_IS_PRODUCTION) throw err;
    }
  }
  // ==== 0) DANA ENTERPRISE — QRIS Acquirer resmi DANA ====
  // Dana masuk LANGSUNG ke saldo DANA merchant pemilik toko. Bila DANA
  // sandbox menolak (kredensial uji bermasalah), lanjut ke penyedia
  // berikutnya dan tampilkan alasannya (fallbackReason). Di mode PRODUKSI
  // tidak ada fallback senyap — galat DANA diteruskan apa adanya.
  let danaFailure: string | null = null;
  if (DANA_ENABLED) {
    try {
      const trx = await createQrisDanaPayment(opts);
      return { ...trx, provider: "dana" };
    } catch (err) {
      danaFailure = err instanceof Error ? err.message : "DANA tidak dapat dihubungi.";
      console.warn("[QRIS] DANA menolak charge — lanjut penyedia berikutnya:", danaFailure);
      if (DANA_IS_PRODUCTION) throw err;
    }
  }
  // ==== 0) CASAKU — QRIS statis toko + listener Android ====
  // Dana 100% masuk rekening pemilik (0% MDR). Bila Casaku menolak (mis.
  // langganan belum aktif / listener offline), lanjut ke penyedia berikutnya
  // dan tampilkan alasannya di layar pembayaran (fallbackReason).
  let casakuFailure: string | null = null;
  if (CASAKU_ENABLED) {
    try {
      const trx = await createCasakuQrisPayment(opts);
      return { ...trx, provider: "casaku" };
    } catch (err) {
      casakuFailure = err instanceof Error ? err.message : "Casaku tidak dapat dihubungi.";
      console.warn("[QRIS] Casaku menolak charge — lanjut penyedia berikutnya:", casakuFailure);
    }
  }
  // ==== 1) MIDTRANS ====
  // Gabungan alasan penyedia utama yang ditolak (transparansi layar bayar)
  const upstreamFailures = [
    dokuFailure ? `DOKU: ${dokuFailure}` : null,
    danaFailure ? `DANA: ${danaFailure}` : null,
    casakuFailure ? `Casaku: ${casakuFailure}` : null,
  ].filter(Boolean) as string[];
  if (MIDTRANS_ENABLED) {
    try {
      const trx = await createQrisMidtransPayment(opts);
      return { ...trx, provider: "midtrans" };
    } catch (err) {
      const authDenied = err instanceof QrisGatewayError && err.status === 401;
      const canFallback = !MIDTRANS_IS_PRODUCTION && QRIS_SANDBOX_ENABLED && !authDenied;
      if (!canFallback) throw err;
      const reason = err instanceof Error ? err.message : "Midtrans tidak dapat dihubungi.";
      console.warn("[QRIS] Midtrans menolak charge — fallback gateway bawaan:", reason);
      const trx = await createSandboxTrx(opts.amount, opts.reference);
      return {
        trxId: trx.trxid,
        qrString: trx.qrString,
        expiresAt: trx.expiresAt.toISOString(),
        provider: "internal",
        fallbackReason:
          [...upstreamFailures, `Midtrans: ${reason}`].join(" — ") || reason,
      };
    }
  }
  // ==== 2) Gateway bawaan (sandbox lokal) ====
  if (QRIS_SANDBOX_ENABLED) {
    const trx = await createSandboxTrx(opts.amount, opts.reference);
    return {
      trxId: trx.trxid,
      qrString: trx.qrString,
      expiresAt: trx.expiresAt.toISOString(),
      provider: "internal",
      ...(upstreamFailures.length ? { fallbackReason: upstreamFailures.join(" — ") } : {}),
    };
  }
  // ==== 3) Penyedia eksternal ====
  try {
    const trx = await requestCreate(opts.reference, opts.amount);
    return { ...trx, provider: "external" };
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    const duplicate =
      msg.includes("reference") || msg.includes("duplicate") || msg.includes("sudah") || msg.includes("exist");
    if (duplicate) {
      const trx = await requestCreate(`${opts.reference}-${Date.now().toString(36)}`, opts.amount);
      return { ...trx, provider: "external" };
    }
    throw err;
  }
}

/**
 * GET status — tanyakan penyedia: sudah masuk belum dananya?
 * Diarahkan otomatis: trxId berawalan "CSK-" = transaksi Casaku, "SBX-" =
 * transaksi gateway bawaan (hasil fallback), selain itu Midtrans /
 * penyedia eksternal.
 */
export async function getQrisGatewayStatus(trxId: string): Promise<GatewayStatus> {
  // ==== -1) DOKU (prefix DOKU-) — QRIS SNAP MPM DOKU ====
  if (isDokuTrx(trxId)) {
    return getQrisDokuStatus(trxId);
  }
  // ==== 0) DANA (prefix DANA-) — QRIS Acquirer resmi DANA ====
  if (isDanaTrx(trxId)) {
    return getQrisDanaStatus(trxId);
  }
  // ==== 0) Transaksi gateway bawaan (prefix SBX-) — termasuk hasil fallback ====
  if (trxId.startsWith("SBX-")) {
    const trx = await getSandboxTrx(trxId);
    if (!trx) {
      // Transaksi tidak dikenal gateway -> supaya layar pembayaran membuat
      // kode bayar baru (route status mengosongkan cache QRIS pesanan).
      throw new QrisGatewayError("Transaksi tidak ditemukan.", 404);
    }
    return normalizeGatewayStatus(trx.status);
  }
  // ==== 1) CASAKU (prefix CSK-) ====
  if (isCasakuTrx(trxId)) {
    return getCasakuStatus(trxId);
  }
  // ==== 2) MIDTRANS ====
  if (MIDTRANS_ENABLED) {
    return getQrisMidtransStatus(trxId);
  }
  // ==== 3) Penyedia eksternal ====
  const body = await gatewayFetch(
    `/payments/${encodeURIComponent(trxId)}/status`,
    { timeoutMs: 6000 }
  );
  const data = dataOf(body);
  const raw = data.status ?? body.status ?? data.paymentStatus ?? body.paymentStatus;
  return normalizeGatewayStatus(raw);
}

// ============================================================
//  PELUNASAN OTOMATIS — satu-satunya jalur QRIS jadi LUNAS
// ============================================================

/**
 * Lunaskan pesanan QRIS oleh SISTEM (polling status / webhook penyedia).
 * - paymentStatus -> PAID, paidAt = sekarang, paidVia = "AUTO"
 * - status PENDING -> PREPARING otomatis (uang masuk, dapur mulai memasak)
 * - Pesanan yang SUDAH DIBATALKAN OTOMATIS (lewat batas 5 menit) tidak
 *   dihidupkan kembali — dana yang masuk terlambat jadi urusan penyedia
 *   (refund), bukan menghidupkan pesanan.
 * - Aman dipanggil bersamaan (webhook + polling): hanya efek pertama yang menang.
 */
export async function markOrderPaidBySystem(orderId: string): Promise<{
  already: boolean;
  cancelled?: boolean;
  order: { id: string; code: string; status: string; paymentStatus: string; paidAt: Date | null; paidVia: string | null };
}> {
  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Pesanan tidak ditemukan.");

    if (order.paymentStatus === "PAID") {
      return { already: true, order };
    }

    // Sudah dibatalkan otomatis karena lewat batas waktu pembayaran
    if (order.status === "CANCELLED") {
      return { already: false, cancelled: true, order };
    }

    // Pelunasan QRIS ditolak bila pesanan bukan QRIS — jalur ini khusus sistem.
    if (order.paymentMethod !== "QRIS") {
      throw new Error("Pesanan ini bukan pembayaran QRIS.");
    }

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: "PAID",
        paidAt: new Date(),
        paidVia: "AUTO",
        // Uang sudah masuk -> dapur langsung memasak (bila masih menunggu)
        ...(order.status === "PENDING" ? { status: "PREPARING" } : {}),
      },
      select: {
        id: true,
        code: true,
        status: true,
        paymentStatus: true,
        paidAt: true,
        paidVia: true,
      },
    });
    return { already: false, order: updated };
  });

  // 🔔 Dana masuk → push heads-up ke staff (masuk dapur) & pelanggan
  // (pembayaran diterima). Hanya untuk pelunasan yang benar-benar baru.
  if (!result.already && !result.cancelled) {
    void notifyOrderPaid(orderId);
  }
  return result;
}

// ===== Throttle: jangan spam penyedia bila banyak layar memantau pesanan sama =====
const lastCheckAt = new Map<string, number>();

/** true bila pesanan ini baru saja dicek ke penyedia (dalam `withinMs`) */
export function recentlyChecked(orderId: string, withinMs = 2000): boolean {
  const t = lastCheckAt.get(orderId);
  if (t == null) return false;
  return Date.now() - t < withinMs;
}

export function markChecked(orderId: string) {
  lastCheckAt.set(orderId, Date.now());
  // Jaga map tetap kecil
  if (lastCheckAt.size > 500) {
    const cutoff = Date.now() - 60_000;
    for (const [k, v] of lastCheckAt) {
      if (v < cutoff) lastCheckAt.delete(k);
    }
  }
}
