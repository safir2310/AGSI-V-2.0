import { randomInt } from "crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { earnPointsForTotal } from "@/lib/points-rules";

/* ================= ATURAN POIN MEMBER ================= */

/**
 * Poin member Ayam Geprek Sambal Ijo.
 *
 * Angka aturannya ada di `points-rules.ts` (murni, aman untuk klien):
 *
 * - Poin MASUK otomatis saat pesanan ditandai SELESAI (bukan saat checkout):
 *   setiap Rp 15.000 dari total pesanan = 100 poin (setara Rp 100 voucher).
 * - Poin bisa ditukar menjadi voucher secara otomatis: 1 poin = Rp 1,
 *   jadi 100 poin = voucher Rp 100. Voucher hasil tukar bersifat PRIBADI
 *   (ownerId) sehingga tidak muncul di daftar voucher publik akun lain.
 */

// Re-ekspor aturan murni agar route server cukup impor dari satu tempat.
export {
  POINTS_EARN_STEP,
  POINTS_EARN_PER_STEP,
  REDEEM_UNIT_POINTS,
  REDEEM_UNIT_VALUE,
  MIN_REDEEM_POINTS,
  earnPointsForTotal,
  voucherValueForPoints,
  POINT_TIERS,
  findPointTier,
} from "@/lib/points-rules";
export type { PointTier } from "@/lib/points-rules";

/** Masa berlaku voucher hasil tukar poin (hari) */
export const REDEEM_VOUCHER_DAYS = 90;

/**
 * Berikan poin ke member saat pesanan berubah status menjadi SELESAI.
 * Dipanggil dari transaksi PUT /api/orders/[id].
 *
 * Idempoten: orderId unik di PointTransaction menjamin satu pesanan hanya
 * pernah menghasilkan satu kali poin (aman dari klik ganda / balapan status).
 *
 * @returns jumlah poin yang benar-benar diberikan (0 jika tidak ada)
 */
export async function awardPointsForOrderCompletion(
  tx: Prisma.TransactionClient,
  order: { id: string; userId: string | null; total: number; code: string }
): Promise<number> {
  if (!order.userId) return 0;
  const points = earnPointsForTotal(order.total);
  if (points <= 0) return 0;

  const existing = await tx.pointTransaction.findUnique({ where: { orderId: order.id } });
  if (existing) return 0;

  await tx.pointTransaction.create({
    data: {
      userId: order.userId,
      type: "EARN",
      points,
      orderId: order.id,
      description: `Point dari pesanan ${order.code}`,
    },
  });
  await tx.user.update({
    where: { id: order.userId },
    data: { points: { increment: points } },
  });
  return points;
}

/* ================= KODE MEMBER & KODE VOUCHER ================= */

/**
 * Kode member: 8 digit angka (ramah pemindai barcode kasir).
 * Nilai dikembalikan sebagai string agar nol di depan aman.
 */
export function generateMemberCode(): string {
  return String(randomInt(10_000_000, 100_000_000));
}

/** Kode voucher hasil tukar poin, cth: PNT-7K2M9Q */
export function generatePointVoucherCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa I,O,0,1 agar mudah dibaca
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += alphabet[randomInt(0, alphabet.length)];
  return `PNT-${suffix}`;
}

/**
 * Pastikan user punya kode member (backfill malas untuk akun lama).
 * Mengembalikan kode member yang pasti terisi.
 */
export async function ensureMemberCode(userId: string): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { memberCode: true } });
  if (user?.memberCode) return user.memberCode;

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateMemberCode();
    try {
      // Atomik: hanya menulis bila kode masih kosong (aman dari balapan)
      const res = await db.user.updateMany({
        where: { id: userId, memberCode: null },
        data: { memberCode: code },
      });
      if (res.count > 0) return code;
    } catch {
      // kode kembar dengan user lain — coba kode baru
      continue;
    }
    // permintaan paralel sudah mengisi → pakai hasilnya
    const again = await db.user.findUnique({ where: { id: userId }, select: { memberCode: true } });
    if (again?.memberCode) return again.memberCode;
  }
  // Fallback terakhir (nyaris mustahil bertabrakan)
  return generateMemberCode();
}
