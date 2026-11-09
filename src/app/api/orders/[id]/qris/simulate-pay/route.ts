import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import {
  CASAKU_ENABLED,
  DANA_ENABLED,
  MIDTRANS_ENABLED,
  QRIS_SANDBOX_ENABLED,
} from "@/lib/qris-config";
import { createSandboxTrx, getSandboxTrx, paySandboxTrx } from "@/lib/qris-sandbox";
import { markOrderPaidBySystem } from "@/lib/qris-gateway";
import { isDigitalPayment } from "@/lib/payments";
import { cancelQrisOrderIfExpired } from "@/lib/order-expiry";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/orders/[id]/qris/simulate-pay
 *
 * Menyelesaikan pembayaran QRIS lewat SIMULASI DANA MASUK — hanya berlaku
 * selama GATEWAY BAWAAN (sandbox) menjadi penyedia AKTIF (tanpa penyedia
 * nyata: DANA / Casaku / Midtrans tidak terkonfigurasi). Gateway bawaan
 * tidak terhubung ke jaringan pembayaran nyata (tidak ada dompet digital
 * yang bisa mengirim notifikasi dana ke aplikasi ini).
 *
 * Cara kerjanya MENIRU alur produksi 1:1 — kebijakan toko tetap utuh:
 *   1. Transaksi ditandai LUNAS di GATEWAY (seperti notifikasi penyedia).
 *   2. Pesanan dilunaskan OLEH SISTEM lewat markOrderPaidBySystem() —
 *      fungsi yang sama dipakai webhook & polling. Kasir tetap TIDAK
 *      punya jalur menandai lunas pesanan secara manual.
 *
 * Saat beralih ke penyedia QRIS sungguhan (DANA/Casaku/Midtrans aktif),
 * route ini otomatis nonaktif (404) dan pelunasan hanya lewat webhook/
 * polling nyata — pesanan QRIS tidak bisa jadi lunas tanpa dana benar-benar
 * masuk ke penyedia.
 *
 * Izin: kasir/admin/owner, atau pemilik pesanan (aplikasi pelanggan).
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const realProviderActive = DANA_ENABLED || CASAKU_ENABLED || MIDTRANS_ENABLED;
  if (!QRIS_SANDBOX_ENABLED || realProviderActive) {
    return NextResponse.json(
      {
        error:
          "Simulasi pembayaran hanya tersedia saat gateway QRIS bawaan (sandbox) menjadi penyedia aktif. Penyedia QRIS sungguhan melunasi pesanan otomatis lewat verifikasi sistem.",
      },
      { status: 404 }
    );
  }

  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  }

  const order = await db.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  }

  const allowed =
    isAdminRole(user.role) || user.role === "CASHIER" || order.userId === user.id;
  if (!allowed) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  if (!isDigitalPayment(order.paymentMethod)) {
    return NextResponse.json(
      { error: "Pesanan ini bukan pembayaran digital (QRIS / E-Wallet)." },
      { status: 400 }
    );
  }
  if (order.paymentStatus === "PAID") {
    return NextResponse.json({ paymentStatus: "PAID", already: true });
  }
  if (order.status === "CANCELLED") {
    return NextResponse.json(
      { error: "Pesanan ini sudah dibatalkan.", cancelled: true },
      { status: 400 }
    );
  }

  // Lewat batas 5 menit & belum dibayar -> batal otomatis, tolak simulasi
  const expired = await cancelQrisOrderIfExpired(order);
  if (expired.cancelled) {
    return NextResponse.json(
      {
        error:
          "Waktu pembayaran habis — pesanan dibatalkan otomatis. Silakan buat pesanan baru.",
        cancelled: true,
      },
      { status: 400 }
    );
  }

  if (order.total <= 0) {
    return NextResponse.json(
      { error: "Total pesanan nol — tidak perlu pembayaran." },
      { status: 400 }
    );
  }

  // ==== 1) Ambil transaksi gateway yang masih hidup; bila tidak ada /
  //      kedaluwarsa / sudah dipangkas, buat kode bayar baru ====
  let trx =
    order.qrisTrxId && order.qrisMode === "GATEWAY"
      ? await getSandboxTrx(order.qrisTrxId)
      : null;
  if (!trx || trx.status === "EXPIRED") {
    trx = await createSandboxTrx(order.total, order.code);
    await db.order.update({
      where: { id: order.id },
      data: {
        qrisTrxId: trx.trxid,
        qrisPayload: trx.qrString,
        qrisMode: "GATEWAY",
        qrisExpiresAt: trx.expiresAt,
      },
    });
  }

  // ==== 2) Dana "masuk" — tandai LUNAS di gateway (meniru dompet digital) ====
  if (trx.status === "PENDING") {
    trx = (await paySandboxTrx(trx.trxid)) ?? trx;
  }
  if (trx.status !== "PAID") {
    return NextResponse.json(
      { error: "Gagal memproses simulasi — coba lagi." },
      { status: 500 }
    );
  }

  // ==== 3) SISTEM melunaskan pesanan (jalur yang sama dengan webhook/polling) ====
  const { already, cancelled, order: updated } = await markOrderPaidBySystem(order.id);
  if (cancelled) {
    return NextResponse.json(
      { error: "Pesanan sudah dibatalkan otomatis.", cancelled: true },
      { status: 409 }
    );
  }

  return NextResponse.json({
    paymentStatus: "PAID",
    paidAt: updated.paidAt?.toISOString() ?? null,
    paidVia: updated.paidVia,
    status: updated.status,
    simulated: true,
    already,
  });
}
