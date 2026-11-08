import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import {
  getQrisGatewayStatus,
  markOrderPaidBySystem,
  markChecked,
  recentlyChecked,
  QrisGatewayError,
} from "@/lib/qris-gateway";
import { cancelQrisOrderIfExpired, QRIS_PAYMENT_TIMEOUT_MS } from "@/lib/order-expiry";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/orders/[id]/qris/status
 *
 * VERIFIKASI OTOMATIS. Dipolling layar pembayaran (pelanggan & kasir):
 * server menanyakan ke penyedia QRIS apakah dananya SUDAH MASUK.
 * Bila ya -> pesanan dilunaskan oleh sistem (paidVia "AUTO") dan
 * langsung masuk antrean dapur. Kasir tidak berperan apa pun di sini.
 *
 * ?force=1 -> lewati throttle (tombol "Periksa Sekarang" di POS).
 */
export async function GET(req: NextRequest, { params }: Params) {
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

  // Batas waktu pesanan (dibuat + 5 menit) — dikirim ke layar pembayaran
  // supaya hitung mundurnya nyata, bukan kosmetik.
  const cancelAt = new Date(order.createdAt.getTime() + QRIS_PAYMENT_TIMEOUT_MS);

  // Lewat batas 5 menit & belum dibayar -> batal otomatis SEKARANG
  // (voucher dikembalikan), lalu kabarkan statusnya.
  const expired = await cancelQrisOrderIfExpired(order);
  if (expired.cancelled) {
    return NextResponse.json({
      paymentStatus: order.paymentStatus,
      status: "CANCELLED",
      cancelled: true,
      autoVerify: true,
      cancelAt: cancelAt.toISOString(),
      notice:
        "Waktu pembayaran habis — pesanan dibatalkan otomatis. Silakan pesan ulang bila masih ingin menikmati geprekmunya.",
    });
  }

  // Sudah lunas? Cukup kabarkan.
  if (order.paymentStatus === "PAID") {
    return NextResponse.json({
      paymentStatus: "PAID",
      paidAt: order.paidAt?.toISOString() ?? null,
      paidVia: order.paidVia,
      status: order.status,
    });
  }

  // Tanpa transaksi gateway (mode lokal / belum buat kode) -> tidak ada yang bisa diverifikasi
  if (!order.qrisTrxId || order.qrisMode !== "GATEWAY") {
    return NextResponse.json({
      paymentStatus: order.paymentStatus,
      status: order.status,
      autoVerify: false,
      cancelAt: cancelAt.toISOString(),
      ...(order.qrisMode === "LOCAL"
        ? {
            notice:
              "Gateway QRIS belum aktif — verifikasi otomatis belum bisa berjalan. Pesanan menunggu hingga penyedia pembayaran terhubung.",
          }
        : {}),
    });
  }

  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!force && recentlyChecked(order.id)) {
    return NextResponse.json({
      paymentStatus: order.paymentStatus,
      status: order.status,
      autoVerify: true,
      checking: true,
      cancelAt: cancelAt.toISOString(),
    });
  }

  try {
    markChecked(order.id);
    const gwStatus = await getQrisGatewayStatus(order.qrisTrxId);

    if (gwStatus === "PAID") {
      // ==== UANG MASUK -> sistem melunaskan pesanan ====
      const { already, cancelled, order: updated } = await markOrderPaidBySystem(order.id);
      if (cancelled) {
        // Dana masuk tepat setelah pesanan dibatalkan otomatis — jangan dihidupkan
        return NextResponse.json({
          paymentStatus: order.paymentStatus,
          status: "CANCELLED",
          cancelled: true,
          autoVerify: true,
          cancelAt: cancelAt.toISOString(),
          notice:
            "Dana terdeteksi masuk setelah batas waktu — pesanan sudah dibatalkan otomatis. Dana dikembalikan penyedia ke pembayar.",
        });
      }
      return NextResponse.json({
        paymentStatus: "PAID",
        paidAt: updated.paidAt?.toISOString() ?? null,
        paidVia: updated.paidVia,
        status: updated.status,
        already,
      });
    }

    return NextResponse.json({
      paymentStatus: order.paymentStatus,
      status: order.status,
      autoVerify: true,
      gatewayStatus: gwStatus,
      cancelAt: cancelAt.toISOString(),
    });
  } catch (err) {
    // Transaksi tidak dikenal penyedia (mis. gateway sandbox baru restart dan
    // memori transaksinya kosong) -> kosongkan cache supaya layar pembayaran
    // membuat kode bayar baru saat dimuat ulang.
    if (err instanceof QrisGatewayError && err.status === 404) {
      await db.order.update({
        where: { id: order.id },
        data: { qrisTrxId: null, qrisPayload: null, qrisMode: null, qrisExpiresAt: null },
      });
      return NextResponse.json({
        paymentStatus: order.paymentStatus,
        status: order.status,
        autoVerify: true,
        gatewayStatus: "EXPIRED",
        cancelAt: cancelAt.toISOString(),
        notice: "Kode bayar tidak lagi dikenal penyedia — buat ulang kode bayar.",
      });
    }
    // Gateway gangguan sesaat -> jangan bikin layar panik, coba lagi nanti
    return NextResponse.json({
      paymentStatus: order.paymentStatus,
      status: order.status,
      autoVerify: true,
      checking: false,
      cancelAt: cancelAt.toISOString(),
      gatewayError:
        err instanceof Error ? err.message : "Gagal menghubungi penyedia QRIS.",
    });
  }
}
