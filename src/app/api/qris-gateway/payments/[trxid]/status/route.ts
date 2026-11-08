import { NextRequest, NextResponse } from "next/server";
import { QRIS_SANDBOX_ENABLED, getSandboxTrx, verifyGatewayApiKey } from "@/lib/qris-sandbox";

type Params = { params: Promise<{ trxid: string }> };

/**
 * GET /api/qris-gateway/payments/:trxid/status
 *
 * Ditanyakan server aplikasi saat polling verifikasi otomatis:
 * "sudah masuk belum dananya?" — persis seperti memanggil penyedia QRIS
 * sungguhan (qriskuu dkk). Header X-API-Key wajib benar.
 */
export async function GET(req: NextRequest, { params }: Params) {
  if (!QRIS_SANDBOX_ENABLED) {
    return NextResponse.json(
      { success: false, code: 404, message: "Gateway sandbox tidak aktif." },
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
  const trx = await getSandboxTrx(trxid);
  if (!trx) {
    return NextResponse.json(
      { success: false, code: 404, message: "Transaksi tidak ditemukan." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      trxid: trx.trxid,
      amount: trx.amount,
      reference: trx.reference,
      status: trx.status,
      expiresAt: trx.expiresAt.toISOString(),
      paidAt: trx.paidAt?.toISOString() ?? null,
    },
  });
}
