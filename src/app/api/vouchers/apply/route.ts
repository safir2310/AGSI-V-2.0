import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkVoucherForUser, normalizeVoucherCode, serializeVoucher } from "@/lib/voucher";

/**
 * POST /api/vouchers/apply — validasi kode voucher untuk pratinjau di keranjang.
 * Body: { code: string, subtotal: number }
 * Belum mencatat pemakaian — pencatatan terjadi saat pesanan dibuat (server
 * memvalidasi ulang di dalam transaksi).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
  }
  try {
    const body = await req.json();
    const code = normalizeVoucherCode(body.code);
    if (!code) {
      return NextResponse.json({ error: "Masukkan dulu kode vouchernya ya." }, { status: 400 });
    }
    const subtotal = Math.max(0, Math.round(Number(body.subtotal) || 0));

    const result = await checkVoucherForUser(code, user.id, subtotal);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      voucher: serializeVoucher(result.voucher, false),
      discount: result.discount,
    });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
