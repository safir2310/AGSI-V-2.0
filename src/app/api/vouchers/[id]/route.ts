import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { isValidVoucherCode, normalizeVoucherCode, serializeVoucherAdmin } from "@/lib/voucher";

type Params = { params: Promise<{ id: string }> };

/** PUT /api/vouchers/[id] — admin memperbarui voucher */
export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!isAdminRole(user?.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const existing = await db.voucher.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Voucher tidak ditemukan." }, { status: 404 });
    }

    const body = await req.json();

    // Toggle cepat: { isActive: boolean } saja
    if (body.isActive != null && Object.keys(body).length === 1) {
      const updated = await db.voucher.update({
        where: { id },
        data: { isActive: body.isActive === true },
      });
      return NextResponse.json({ voucher: serializeVoucherAdmin(updated) });
    }

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
      return NextResponse.json({ error: "Kode voucher 3-24 karakter, hanya huruf, angka, dan tanda hubung." }, { status: 400 });
    }
    if (title.length < 3 || title.length > 60) {
      return NextResponse.json({ error: "Judul voucher wajib diisi (3-60 karakter)." }, { status: 400 });
    }
    if (!Number.isFinite(value) || value <= 0) {
      return NextResponse.json({ error: "Nilai diskon harus lebih dari 0." }, { status: 400 });
    }
    if (type === "PERCENT" && value > 100) {
      return NextResponse.json({ error: "Diskon persen maksimal 100%." }, { status: 400 });
    }
    if (type === "FIXED" && value < 100) {
      return NextResponse.json({ error: "Nominal potongan minimal Rp 100." }, { status: 400 });
    }
    if (type === "PERCENT" && maxDiscount != null && (!Number.isFinite(maxDiscount) || maxDiscount < 100)) {
      return NextResponse.json({ error: "Batas potongan maksimal minimal Rp 100." }, { status: 400 });
    }
    if (quota < existing.usedCount) {
      return NextResponse.json(
        { error: `Kuota tidak boleh kurang dari pemakaian saat ini (${existing.usedCount}x).` },
        { status: 400 }
      );
    }

    let expiresAt: Date | null = null;
    if (body.expiresAt != null && body.expiresAt !== "") {
      const d = new Date(String(body.expiresAt));
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Format masa berlaku tidak valid." }, { status: 400 });
      }
      expiresAt = d;
    }

    if (code !== existing.code) {
      const clash = await db.voucher.findUnique({ where: { code } });
      if (clash) {
        return NextResponse.json({ error: `Kode ${code} sudah dipakai voucher lain.` }, { status: 400 });
      }
    }

    const updated = await db.voucher.update({
      where: { id },
      data: {
        code,
        title,
        description: body.description ? String(body.description).trim().slice(0, 200) : null,
        type,
        value,
        minPurchase,
        maxDiscount,
        quota,
        isActive,
        expiresAt,
      },
    });
    return NextResponse.json({ voucher: serializeVoucherAdmin(updated) });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}

/** DELETE /api/vouchers/[id] — admin menghapus voucher */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!isAdminRole(user?.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const existing = await db.voucher.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Voucher tidak ditemukan." }, { status: 404 });
    }
    // Riwayat pemakaian ikut terhapus (cascade); pesanan lama tetap menyimpan
    // snapshot kode & potongan pada kolom order.voucherCode / voucherDiscount.
    await db.voucher.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
