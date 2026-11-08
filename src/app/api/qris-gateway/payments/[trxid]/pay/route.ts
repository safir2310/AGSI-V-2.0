import { NextRequest, NextResponse } from "next/server";
import {
  QRIS_SANDBOX_ENABLED,
  paySandboxTrx,
  verifyGatewayApiKey,
} from "@/lib/qris-sandbox";

type Params = { params: Promise<{ trxid: string }> };

/**
 * POST /api/qris-gateway/payments/:trxid/pay
 *
 * Endpoint GATEWAY BAWAAN (sandbox) yang meniru notifikasi "dana masuk"
 * dari aplikasi dompet digital (GoPay/OVO/DANA/ShopeePay/m-Banking) —
 * persis seperti notifikasi yang dikirim penyedia QRIS sungguhan.
 * Dipakai kasir/penjual untuk MENYELESAIKAN demo pembayaran QRIS dari POS
 * selama gateway bawaan aktif (QRIS_SANDBOX). Begitu beralih ke penyedia
 * QRIS sungguhan (QRIS_SANDBOX=false + QRIS_GATEWAY_URL eksternal), route
 * ini otomatis nonaktif dan pelunasan hanya lewat webhook/polling nyata.
 *
 * Autentikasi: header X-API-Key (kunci pemilik toko) — sama seperti endpoint
 * gateway lainnya.
 */
export async function POST(req: NextRequest, { params }: Params) {
  if (!QRIS_SANDBOX_ENABLED) {
    return NextResponse.json(
      {
        success: false,
        code: 404,
        message:
          "Simulasi pembayaran hanya tersedia saat gateway QRIS bawaan (sandbox) aktif.",
      },
      { status: 404 }
    );
  }
  if (!verifyGatewayApiKey(req)) {
    return NextResponse.json(
      { success: false, code: 401, message: "Invalid API key" },
      { status: 401 }
    );
  }

  const { trxid } = await params;
  const trx = await paySandboxTrx(trxid);

  if (!trx) {
    return NextResponse.json(
      { success: false, code: 404, message: "Transaksi tidak ditemukan." },
      { status: 404 }
    );
  }
  if (trx.status === "EXPIRED") {
    return NextResponse.json(
      { success: false, code: 409, message: "Kode bayar sudah kedaluwarsa." },
      { status: 409 }
    );
  }

  return NextResponse.json({
    success: true,
    code: 200,
    message: "Dana diterima — transaksi lunas.",
    data: {
      trxid: trx.trxid,
      amount: trx.amount,
      reference: trx.reference,
      status: trx.status,
      paidAt: trx.paidAt?.toISOString() ?? null,
    },
  });
}
