import { isDigitalPayment } from "@/lib/payments";

/**
 * ATURAN UANG COD KURIR — fungsi MURNI (tanpa DB/jaringan) agar mudah
 * diuji offline. Dipakai API pesanan & setoran kurir; test perilaku ada
 * di scripts/test-courier-setoran.ts.
 *
 * Alur uang tunai COD (bayar di tempat):
 *  1. Kurir menyelesaikan pesanan antar tunai yang belum lunas → uang
 *     berpindah ke tangan kurir → pesanan ditandai lunas paidVia "COD".
 *  2. Uang menunggak dihitung dari pesanan paidVia "COD" yang belum
 *     terikat setoran (codSetoranId NULL).
 *  3. Kurir menekan "Setor ke Admin" → semua pesanan tertunggak diikat
 *     ke satu CourierSetoran → jumlah yang harus disetor kembali ke 0.
 */

type OrderLike = {
  id?: string;
  type?: string;
  status?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  paidVia?: string | null;
  courierUserId?: string | null;
  codSetoranId?: string | null;
  total?: number;
  deliveryFee?: number | null;
};

type UserLike = { id: string; role: string };

export const COD_PAID_VIA = "COD" as const;

/** Pesanan antar tunai (COD / bayar di tempat) — bukan QRIS / e-wallet. */
export function isCodDelivery(order: OrderLike): boolean {
  return order.type === "DELIVERY" && !isDigitalPayment(order.paymentMethod);
}

/**
 * Keputusan kurir menyelesaikan pesanan ("Sampai Tujuan"). Kurir hanya
 * boleh: menandai COMPLETED pesanan ANTAR yang ditugaskan kepadanya
 * (courierUserId = id kurir) dan sedang READY. Selain itu ditolak.
 */
export function courierCompleteDecision(
  user: UserLike,
  order: OrderLike | null,
  body: unknown
): { ok: boolean; code?: number; error?: string } {
  if (user.role !== "COURIER") return { ok: false, code: 403, error: "Bukan akun kurir." };
  const status = (body as { status?: unknown } | null)?.status;
  if (status !== "COMPLETED") {
    return {
      ok: false,
      code: 403,
      error: "Kurir hanya bisa menandai pesanan 'Sampai Tujuan' (selesai).",
    };
  }
  if (!order) return { ok: false, code: 404, error: "Pesanan tidak ditemukan." };
  if (order.courierUserId !== user.id) {
    return { ok: false, code: 403, error: "Pesanan ini bukan tugas antaranmu." };
  }
  if (order.status !== "READY") {
    return { ok: false, code: 400, error: "Pesanan sudah diproses atau diselesaikan sebelumnya." };
  }
  return { ok: true };
}

/**
 * Penandaan pembayaran saat kurir menyelesaikan pesanan. Uang tunai COD
 * yang belum lunas → lunas di tempat, paidVia "COD" (di tangan kurir).
 * Pembayaran digital TIDAK ditandai (pelunasan hanya oleh sistem saat
 * dana masuk) dan yang sudah lunas tidak diutak-atik.
 */
export function codCompletionMarking(order: OrderLike): {
  paymentStatus?: "PAID";
  paidVia?: typeof COD_PAID_VIA;
} | null {
  if (!isCodDelivery(order)) return null;
  if (order.paymentStatus === "PAID") return null;
  return { paymentStatus: "PAID", paidVia: COD_PAID_VIA };
}

/** Uang COD yang masih di tangan kurir: paidVia "COD" & belum disetor. */
export function isUndepositedCod(order: OrderLike): boolean {
  return order.paidVia === COD_PAID_VIA && order.codSetoranId == null;
}

/**
 * NOMINAL PESANAN yang disetor kurir ke admin: total dikurangi ongkir.
 * (total = subtotal + serviceFee + ongkir − voucher — lihat pembuatan
 * pesanan). Ongkir BUKAN uang admin — itu pendapatan kurir.
 */
export function menuMoneyOf(order: OrderLike): number {
  return Math.max(0, (order.total ?? 0) - (order.deliveryFee ?? 0));
}

/** Ongkir pesanan = PENDAPATAN KURIR (tetap di tangan kurir). */
export function courierIncomeOf(order: OrderLike): number {
  return order.deliveryFee ?? 0;
}

/**
 * Ringkasan kantong COD kurir: uang menu yang harus disetor ke admin +
 * ongkir yang menjadi pendapatan kurir + banyaknya pesanan tertunggak.
 * Setelah disetor (pesanan terikat setoran), semuanya kembali ke 0.
 */
export function setoranSummary(
  orders: OrderLike[]
): { amount: number; ongkir: number; count: number } {
  const eligible = orders.filter(isUndepositedCod);
  return {
    amount: eligible.reduce((sum, o) => sum + menuMoneyOf(o), 0),
    ongkir: eligible.reduce((sum, o) => sum + courierIncomeOf(o), 0),
    count: eligible.length,
  };
}
