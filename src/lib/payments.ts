/**
 * Metode pembayaran aplikasi — SATU sumber kebenaran.
 *
 * CASH    : tunai di kasir / bayar saat ambil.
 * QRIS    : pembayaran digital via DOKU — UPDATE (permintaan pemilik,
 *           2026-11-26): halaman bayar DOKU TANPA filter kanal, jadi pelanggan
 *           memilih dari SEMUA metode aktif akun DOKU: QRIS (pindai pakai
 *           GoPay, DANA, OVO, ShopeePay, LinkAja, m-Banking apa pun), DOKU
 *           Wallet, e-wallet, Virtual Account, & kanal aktif lainnya.
 * EWALLET : nilai LAMA (pesanan historis) — kini berjalan lewat halaman yang
 *           sama: semua metode DOKU tanpa filter kanal.
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
