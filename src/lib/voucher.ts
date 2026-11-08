import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { computeVoucherDiscount, formatIDR, type VoucherAdminInfo, type VoucherInfo } from "@/lib/types";

/** Tipe Prisma Voucher (baris database) */
type VoucherRow = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  type: string;
  value: number;
  minPurchase: number;
  maxDiscount: number | null;
  quota: number;
  usedCount: number;
  expiresAt: Date | null;
  isActive: boolean;
  ownerId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Normalisasi kode voucher: huruf besar, buang spasi */
export function normalizeVoucherCode(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/** Validasi format kode voucher: 3-24 karakter A-Z, 0-9, tanda hubung */
export function isValidVoucherCode(code: string): boolean {
  return /^[A-Z0-9-]{3,24}$/.test(code);
}

export function isVoucherExpired(v: { expiresAt: Date | null }): boolean {
  return !!v.expiresAt && v.expiresAt.getTime() < Date.now();
}

/** Voucher masih bisa dipakai sama sekali? (aktif + belum kedaluwarsa + kuota tersisa) */
export function isVoucherUsable(v: { isActive: boolean; expiresAt: Date | null; quota: number; usedCount: number }): boolean {
  return v.isActive && !isVoucherExpired(v) && v.usedCount < v.quota;
}

/** Serialize voucher untuk halaman pelanggan */
export function serializeVoucher(v: VoucherRow, usedByMe: boolean): VoucherInfo {
  return {
    id: v.id,
    code: v.code,
    title: v.title,
    description: v.description,
    type: v.type === "FIXED" ? "FIXED" : "PERCENT",
    value: v.value,
    minPurchase: v.minPurchase,
    maxDiscount: v.maxDiscount,
    expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
    remaining: Math.max(0, v.quota - v.usedCount),
    usedByMe,
    ownerOnly: !!v.ownerId,
  };
}

/** Serialize voucher versi admin */
export function serializeVoucherAdmin(v: VoucherRow, usedByMe = false): VoucherAdminInfo {
  return {
    ...serializeVoucher(v, usedByMe),
    quota: v.quota,
    usedCount: v.usedCount,
    isActive: v.isActive,
    createdAt: v.createdAt.toISOString(),
  };
}

/**
 * Validasi voucher untuk seorang pelanggan & subtotal tertentu.
 * Aturan "sekali pakai": satu userId hanya boleh menukar voucher yang sama sekali.
 * Dipakai baik oleh /api/vouchers/apply (pratinjau) maupun /api/orders (checkout final).
 * `client` bisa berupa db biasa atau klien transaksi — checkout memakai transaksi
 * agar dua pesanan bersamaan tidak bisa menyedot kuota yang sama.
 */
export async function checkVoucherForUser(
  code: string,
  userId: string,
  subtotal: number,
  client: Prisma.TransactionClient = db
): Promise<{ ok: true; voucher: VoucherRow; discount: number } | { ok: false; error: string }> {
  const voucher = await client.voucher.findUnique({ where: { code } });
  if (!voucher || !voucher.isActive) {
    return { ok: false, error: "Kode voucher tidak ditemukan atau tidak aktif." };
  }
  if (isVoucherExpired(voucher)) {
    return { ok: false, error: "Voucher ini sudah kedaluwarsa." };
  }
  if (voucher.usedCount >= voucher.quota) {
    return { ok: false, error: "Kuota voucher ini sudah habis dipakai." };
  }
  const used = await client.voucherRedemption.findUnique({
    where: { voucherId_userId: { voucherId: voucher.id, userId } },
  });
  if (used) {
    return { ok: false, error: "Voucher ini sudah pernah kamu pakai — sekali pakai saja ya 😊" };
  }
  // Voucher pribadi (hasil tukar poin) hanya boleh dipakai pemilik kodenya
  if (voucher.ownerId && voucher.ownerId !== userId) {
    return { ok: false, error: "Voucher ini bukan milik akunmu." };
  }
  if (subtotal < voucher.minPurchase) {
    return {
      ok: false,
      error: `Minimal belanja ${formatIDR(voucher.minPurchase)} untuk memakai voucher ini.`,
    };
  }
  const discount = computeVoucherDiscount(
    {
      type: voucher.type === "FIXED" ? "FIXED" : "PERCENT",
      value: voucher.value,
      minPurchase: voucher.minPurchase,
      maxDiscount: voucher.maxDiscount,
    },
    subtotal
  );
  return { ok: true, voucher, discount };
}
