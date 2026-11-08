import { NextRequest, NextResponse } from "next/server";
import {
  QRIS_SANDBOX_ENABLED,
  createSandboxTrx,
  verifyGatewayApiKey,
} from "@/lib/qris-sandbox";

/**
 * POST /api/qris-gateway/payments
 *
 * Endpoint gateway QRIS sandbox (gaya API qriskuu) — dipanggil OLEH SERVER
 * aplikasi (bukan dari browser), diautentikasi dengan header X-API-Key
 * milik pemilik toko. Membuat transaksi QRIS dinamis dengan nominal melekat.
 *
 * Aktif hanya saat QRIS_SANDBOX=true; saat berpindah ke penyedia sungguhan
 * (QRIS_GATEWAY_URL eksternal) route ini otomatis nonaktif.
 */
export async function POST(req: NextRequest) {
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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, code: 400, message: "Body bukan JSON." },
      { status: 400 }
    );
  }

  const amount = Math.round(Number(body.amount));
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";

  if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000_000) {
    return NextResponse.json(
      { success: false, code: 400, message: "Nominal harus 1–1.000.000.000." },
      { status: 400 }
    );
  }
  if (!reference) {
    return NextResponse.json(
      { success: false, code: 400, message: "Referensi wajib diisi." },
      { status: 400 }
    );
  }

  const trx = await createSandboxTrx(amount, reference);

  return NextResponse.json(
    {
      success: true,
      code: 201,
      message: "Transaksi QRIS dinamis berhasil dibuat.",
      data: {
        trxid: trx.trxid,
        amount: trx.amount,
        reference: trx.reference,
        qrString: trx.qrString,
        status: trx.status,
        createdAt: trx.createdAt.toISOString(),
        expiresAt: trx.expiresAt.toISOString(),
      },
    },
    { status: 201 }
  );
}
