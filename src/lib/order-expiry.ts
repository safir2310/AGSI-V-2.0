import { db } from "@/lib/db";
import { isDigitalPayment, PAYMENT_METHOD_DIGITAL_IN } from "@/lib/payments";

/**
 * Batas waktu pembayaran digital (QRIS / E-Wallet) — permintaan pemilik: 5 MENIT.
 *
 * Pesanan digital yang belum dibayar:
 *   1. TIDAK masuk ke daftar pesanan admin/kasir (belum "terjadi" —
 *      pesanan baru masuk dapur setelah dana terverifikasi masuk).
 *   2. Dibatalkan OTOMATIS bila lewat batas waktu ini sejak pesanan dibuat.
 *      Voucher yang terpakai dikembalikan ke pelanggan.
 */
export const QRIS_PAYMENT_TIMEOUT_MINUTES = 5;

/** Batas waktu (ms) sejak dibuat sebelum pesanan digital batal otomatis */
export const QRIS_PAYMENT_TIMEOUT_MS = QRIS_PAYMENT_TIMEOUT_MINUTES * 60 * 1000;

/**
 * Predikat: pesanan digital (QRIS/E-Wallet) dari APLIKASI pelanggan yang belum
 * dibayar — pesanan seperti ini TIDAK PERNAH masuk ke daftar admin/kasir: saat
 * menunggu bayar maupun setelah dibatalkan otomatis (audit tetap ada di daftar
 * pelanggan). (Pesanan digital buatan POS tetap tampil: kasir memantau
 * langsung di kasir.)
 */
export function isHiddenUnpaidAppQris(o: {
  source: string;
  paymentMethod: string;
  paymentStatus: string;
}): boolean {
  return (
    o.source === "APP" &&
    isDigitalPayment(o.paymentMethod) &&
    o.paymentStatus === "UNPAID"
  );
}

/** Kondisi Prisma: pesanan digital app yang belum dibayar (untuk filter NOT) */
export const HIDDEN_UNPAID_APP_QRIS_WHERE = {
  source: "APP" as const,
  paymentMethod: PAYMENT_METHOD_DIGITAL_IN,
  paymentStatus: "UNPAID" as const,
};

type ExpiryInput = { id: string; paymentMethod: string; paymentStatus: string; status: string; createdAt: Date };

/**
 * Batalkan SATU pesanan bila waktunya sudah habis (QRIS + belum bayar +
 * masih PENDING + dibuat > 5 menit lalu). Voucher dikembalikan.
 * Aman dipanggil berkali-kali dan aman berbalapan dengan webhook dana masuk:
 * status dibaca ulang DI DALAM transaksi.
 */
export async function cancelQrisOrderIfExpired(
  order: ExpiryInput
): Promise<{ cancelled: boolean }> {
  if (
    !isDigitalPayment(order.paymentMethod) ||
    order.paymentStatus !== "UNPAID" ||
    order.status !== "PENDING" ||
    order.createdAt.getTime() > Date.now() - QRIS_PAYMENT_TIMEOUT_MS
  ) {
    return { cancelled: false };
  }

  try {
    await db.$transaction(async (tx) => {
      const cur = await tx.order.findUnique({
        where: { id: order.id },
        select: { id: true, paymentStatus: true, status: true, voucherCode: true },
      });
      // Dana sudah masuk / sudah dibatalkan / sudah diproses -> jangan sentuh
      if (!cur || cur.paymentStatus !== "UNPAID" || cur.status !== "PENDING") return;

      await tx.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED" },
      });

      // Kembalikan voucher pelanggan (bisa dipakai lagi untuk pesanan lain)
      if (cur.voucherCode) {
        const redemption = await tx.voucherRedemption.findUnique({
          where: { orderId: order.id },
        });
        if (redemption) {
          await tx.voucherRedemption.delete({ where: { id: redemption.id } });
          await tx.voucher.update({
            where: { id: redemption.voucherId },
            data: { usedCount: { decrement: 1 } },
          });
        }
      }
    });
    return { cancelled: true };
  } catch {
    return { cancelled: false };
  }
}

/**
 * Sapu bersih SEMUA pesanan QRIS yang sudah lewat batas waktu pembayaran.
 * Dipanggil oportunistik setiap kali daftar pesanan dimuat (admin / pelanggan)
 * dan saat status QRIS dipolling — jadi pesanan kedaluwarsa selalu tertangani
 * tanpa perlu layanan cron terpisah.
 */
export async function cancelExpiredQrisOrders(): Promise<number> {
  const cutoff = new Date(Date.now() - QRIS_PAYMENT_TIMEOUT_MS);
  const expired = await db.order.findMany({
    where: {
      paymentMethod: PAYMENT_METHOD_DIGITAL_IN,
      paymentStatus: "UNPAID",
      status: "PENDING",
      createdAt: { lt: cutoff },
    },
    select: { id: true, paymentMethod: true, paymentStatus: true, status: true, createdAt: true },
    take: 50,
  });

  let n = 0;
  for (const o of expired) {
    const r = await cancelQrisOrderIfExpired(o);
    if (r.cancelled) n++;
  }
  return n;
}
