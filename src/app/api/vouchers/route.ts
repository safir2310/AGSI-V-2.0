import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import {
  isValidVoucherCode,
  isVoucherExpired,
  normalizeVoucherCode,
  serializeVoucher,
  serializeVoucherAdmin,
} from "@/lib/voucher";

/**
 * GET /api/vouchers
 * - Pelanggan (tanpa scope): daftar voucher yang masih bisa dipakai (aktif,
 *   belum kedaluwarsa, kuota tersisa) + penanda "sudah dipakai akun ini".
 * - Admin ?scope=all: semua voucher termasuk nonaktif/habis.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope");

  if (scope === "all") {
    if (!isAdminRole(user?.role)) {
      return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
    }
    const vouchers = await db.voucher.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json({ vouchers: vouchers.map((v) => serializeVoucherAdmin(v)) });
  }

  // Daftar untuk halaman pelanggan: voucher promo publik (ownerId null) +
  // voucher pribadi hasil tukar poin milik akun ini saja
  const vouchers = await db.voucher.findMany({
    where: {
      isActive: true,
      OR: [{ ownerId: null }, ...(user ? [{ ownerId: user.id }] : [])],
    },
    orderBy: [{ minPurchase: "asc" }, { createdAt: "desc" }],
  });
  const usable = vouchers.filter((v) => !isVoucherExpired(v) && v.usedCount < v.quota);

  let usedIds = new Set<string>();
  if (user) {
    const redemptions = await db.voucherRedemption.findMany({
      where: { userId: user.id },
      select: { voucherId: true },
    });
    usedIds = new Set(redemptions.map((r) => r.voucherId));
  }
  return NextResponse.json({
    vouchers: usable.map((v) => serializeVoucher(v, usedIds.has(v.id))),
  });
}

/** Validasi & rapikan payload voucher dari admin */
function parseVoucherBody(body: Record<string, unknown>) {
  const code = normalizeVoucherCode(body.code);
  const title = String(body.title ?? "").trim();
  const type = body.type === "FIXED" ? "FIXED" : "PERCENT";
  const value = Math.round(Number(body.value));
  const minPurchase = Math.max(0, Math.round(Number(body.minPurchase ?? 0) || 0));
  const maxDiscount =
    body.maxDiscount == null || body.maxDiscount === "" ? null : Math.round(Number(body.maxDiscount));
  const quota = Math.max(1, Math.round(Number(body.quota ?? 1) || 1));
  const isActive = body.isActive !== false;

  if (!isValidVoucherCode(code)) {
    return { error: "Kode voucher 3-24 karakter, hanya huruf, angka, dan tanda hubung." };
  }
  if (title.length < 3 || title.length > 60) {
    return { error: "Judul voucher wajib diisi (3-60 karakter)." };
  }
  if (!Number.isFinite(value) || value <= 0) {
    return { error: "Nilai diskon harus lebih dari 0." };
  }
  if (type === "PERCENT" && value > 100) {
    return { error: "Diskon persen maksimal 100%." };
  }
  if (type === "FIXED" && value < 100) {
    return { error: "Nominal potongan minimal Rp 100." };
  }
  if (type === "PERCENT" && maxDiscount != null && (!Number.isFinite(maxDiscount) || maxDiscount < 100)) {
    return { error: "Batas potongan maksimal minimal Rp 100." };
  }

  // Masa berlaku opsional
  let expiresAt: Date | null = null;
  if (body.expiresAt != null && body.expiresAt !== "") {
    const d = new Date(String(body.expiresAt));
    if (isNaN(d.getTime())) {
      return { error: "Format masa berlaku tidak valid." };
    }
    expiresAt = d;
  }

  return { code, title, type, value, minPurchase, maxDiscount, quota, isActive, expiresAt };
}

/** POST /api/vouchers — admin membuat voucher baru */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!isAdminRole(user?.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  try {
    const body = await req.json();
    const parsed = parseVoucherBody(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const clash = await db.voucher.findUnique({ where: { code: parsed.code } });
    if (clash) {
      return NextResponse.json({ error: `Kode ${parsed.code} sudah dipakai voucher lain.` }, { status: 400 });
    }

    const voucher = await db.voucher.create({
      data: {
        code: parsed.code,
        title: parsed.title,
        description: body.description ? String(body.description).trim().slice(0, 200) : null,
        type: parsed.type,
        value: parsed.value,
        minPurchase: parsed.minPurchase,
        maxDiscount: parsed.maxDiscount,
        quota: parsed.quota,
        isActive: parsed.isActive,
        expiresAt: parsed.expiresAt,
      },
    });
    return NextResponse.json({ voucher: serializeVoucherAdmin(voucher) });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
