/* ============ ATURAN POIN MEMBER (MURNI — AMAN UNTUK KLIEN) ============
 *
 * Modul ini sengaja TIDAK mengimpor apa pun dari server (db, crypto, dll)
 * supaya bisa dipakai langsung oleh komponen klien (preview poin di
 * keranjang, kartu member, dsb.) sekaligus oleh logika server.
 *
 * ATURAN RESMI:
 *  - BELANJA: setiap Rp 15.000 dari total pesanan yang SELESAI
 *    menghasilkan 100 poin (setara Rp 100 voucher — lihat rate tukar).
 *  - TUKAR  : 1 poin = Rp 1 nominal voucher → 100 poin = voucher Rp 100.
 *    Nominal voucher SELALU mengikuti jumlah poin yang ditukar.
 */

/** Belanja (Rp) yang menghasilkan satu paket poin */
export const POINTS_EARN_STEP = 15_000;

/** Jumlah poin per paket belanja POINTS_EARN_STEP */
export const POINTS_EARN_PER_STEP = 100;

/** Rate tukar resmi: REDEEM_UNIT_POINTS poin = Rp REDEEM_UNIT_VALUE */
export const REDEEM_UNIT_POINTS = 100;
export const REDEEM_UNIT_VALUE = 100;

/** Minimal poin yang boleh ditukar menjadi voucher */
export const MIN_REDEEM_POINTS = 100;

/** Poin yang didapat dari sebuah total pesanan (Rp) */
export function earnPointsForTotal(total: number): number {
  return Math.max(0, Math.floor(total / POINTS_EARN_STEP) * POINTS_EARN_PER_STEP);
}

/** Nominal voucher (Rp) dari poin yang ditukar — 100 poin = Rp 100 */
export function voucherValueForPoints(points: number): number {
  const rate = REDEEM_UNIT_VALUE / REDEEM_UNIT_POINTS; // 1 poin = Rp 1
  return Math.max(0, Math.round(points * rate));
}

/** Pilihan penukaran cepat — nominal voucher selalu 1:1 dengan poin */
export type PointTier = {
  id: string;
  points: number;
  /** nominal voucher (Rp) — sesuai poin: 100 poin = Rp 100 */
  value: number;
};

export const POINT_TIERS: PointTier[] = [
  { id: "P100", points: 100, value: 100 },
  { id: "P500", points: 500, value: 500 },
  { id: "P1000", points: 1000, value: 1000 },
  { id: "P5000", points: 5000, value: 5000 },
];

export function findPointTier(id: unknown): PointTier | null {
  const key = String(id ?? "").trim().toUpperCase();
  return POINT_TIERS.find((t) => t.id === key) ?? null;
}
