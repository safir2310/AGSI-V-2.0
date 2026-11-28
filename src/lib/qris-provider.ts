/**
 * Tipe & utilitas BERSAMA semua penyedia QRIS (gateway bawaan, Midtrans,
 * penyedia eksternal). Dipisah modul sendiri agar adapter penyedia
 * (mis. qris-midtrans.ts) dan qris-gateway.ts tidak saling mengimpor
 * secara melingkar — semua route tetap mengimpor dari qris-gateway.
 *
 * Prinsip penting (kebijakan pemilik toko):
 *   Pesanan QRIS hanya boleh dilunaskan OLEH SISTEM saat dana BENAR-BENAR
 *   masuk (polling status / webhook penyedia). Kasir / admin TIDAK PUNYA
 *   jalur menandai lunas pesanan QRIS secara manual.
 */

/** Kata kunci status di berbagai penyedia -> status baku aplikasi */
export type GatewayStatus = "PAID" | "PENDING" | "EXPIRED" | "UNKNOWN";

const PAID_WORDS = [
  "paid", "settle", "settled", "settlement", "success", "succeeded",
  "lunas", "completed", "complete", "capture", "captured",
];
const EXPIRED_WORDS = [
  "expired", "expire", "cancel", "cancelled", "canceled", "void",
  "failed", "failure", "denied", "deny", "refunded", "refund",
];
const PENDING_WORDS = [
  "pending", "unpaid", "waiting", "created", "new", "active", "ongoing",
  "processing", "process", "challenge",
];

export function normalizeGatewayStatus(raw: unknown): GatewayStatus {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "UNKNOWN";
  if (PAID_WORDS.some((w) => s.includes(w))) return "PAID";
  if (EXPIRED_WORDS.some((w) => s.includes(w))) return "EXPIRED";
  if (PENDING_WORDS.some((w) => s.includes(w))) return "PENDING";
  return "UNKNOWN";
}

/** Transaksi QRIS dinamis hasil buat di gateway */
export type GatewayTransaction = {
  trxId: string;
  /** String QRIS siap dirender jadi QR code */
  qrString?: string;
  /** URL gambar QR (jika penyedia hanya memberi gambar) */
  imageUrl?: string;
  /** URL halaman pembayaran (jalur DOKU Checkout — pelanggan menyelesaikan
   *  pembayaran di halaman DOKU; status tetap diverifikasi otomatis) */
  paymentUrl?: string;
  expiresAt?: string | null;
  /** Penyedia yang benar-benar melayani: "casaku" | "midtrans" | "internal" | "external" */
  provider?: string;
  /** Bila provider fallback, alasan penyedia utama ditolak (untuk log/nota) */
  fallbackReason?: string;
  /** Nominal FINAL yang harus dibayar pelanggan (total + kode unik Casaku) */
  finalAmount?: number;
  /** Kode unik acak yang disematkan Casaku ke nominal (bila aktif) */
  uniqueCode?: number;
};

export class QrisGatewayError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "QrisGatewayError";
    this.status = status;
  }
}
