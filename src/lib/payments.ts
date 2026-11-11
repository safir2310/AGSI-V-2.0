/**
 * Metode pembayaran aplikasi — SATU sumber kebenaran.
 *
 * CASH    : tunai di kasir / bayar saat ambil.
 * QRIS    : pembayaran digital gateway via QRIS E-WALLET DOKU — halaman
 *           bayar DOKU difilter ke SATU kanal "QRIS" sehingga pelanggan
 *           LANGSUNG diarahkan ke pembayaran QRIS (pindai pakai GoPay,
 *           DANA, OVO, ShopeePay, LinkAja, m-Banking apa pun). Bila kanal
 *           QRIS akun DOKU belum aktif, adapter otomatis mencoba ulang
 *           tanpa filter (semua kanal aktif penyedia).
 * EWALLET : pembayaran digital gateway dengan halaman bayar DOKU yang
 *           DIFILTER ke kanal e-wallet (DOKU Wallet, DANA, OVO, ShopeePay,
 *           LinkAja — sesuai kanal yang diaktifkan DOKU untuk merchant).
 *
 * QRIS dan EWALLET sama-sama pembayaran DIGITAL gateway: dibuat lewat
 * penyedia yang sama, diverifikasi otomatis (polling + webhook), dan
 * HANYA boleh dilunasi SISTEM saat dana benar-benar masuk.
 */

/** Metode pembayaran gateway (non-tunai) yang diverifikasi otomatis */
export const DIGITAL_PAYMENT_METHODS = ["QRIS", "EWALLET"] as const;

export type PaymentMethod = "CASH" | (typeof DIGITAL_PAYMENT_METHODS)[number];

/** true bila metode ini pembayaran gateway (QRIS / E-Wallet) */
export function isDigitalPayment(method: string | null | undefined): boolean {
  return method === "QRIS" || method === "EWALLET";
}

/** Label singkat untuk UI: QRIS / E-Wallet / Tunai */
export function paymentMethodLabel(method: string | null | undefined): string {
  if (method === "QRIS") return "QRIS";
  if (method === "EWALLET") return "E-Wallet";
  return "Tunai";
}

/** Emoji chip pembayaran untuk UI */
export function paymentMethodEmoji(method: string | null | undefined): string {
  if (method === "QRIS") return "📱";
  if (method === "EWALLET") return "👛";
  return "💵";
}

/** Kondisi Prisma: paymentMethod salah satu metode digital */
export const PAYMENT_METHOD_DIGITAL_IN: { in: string[] } = {
  in: ["QRIS", "EWALLET"],
};
