import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { markOrderPaidBySystem } from "@/lib/qris-gateway";
import { QRIS_STATIS_AUTO_CONFIRM, QRIS_STATIS_TTL_MINUTES } from "@/lib/qris-statis";
import { cancelQrisOrderIfExpired } from "@/lib/order-expiry";
import { formatIDR } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/orders/[id]/qris/declare
 *
 * PELANGGAN MENYATAKAN "SAYA SUDAH BAYAR" pada pembayaran QRIS STATIS TOKO.
 *
 * QRIS statis (poster QRIS milik pemilik) tidak punya callback penyedia —
 * tidak ada dompet digital yang memberi tahu aplikasi "dana sudah masuk".
 * Sumber konfirmasinya:
 *   1. Deklarasi pelanggan lewat route ini (dengan jejak waktu), lalu:
 *        - Mode AUTO  (QRIS_STATIS_AUTO_CONFIRM=true, default): sistem
 *          LANGSUNG melunaskan pesanan (verifikasi otomatis) — paidVia
 *          "AUTO", pesanan masuk dapur, push terkirim. Jejak deklarasi
 *          tersimpan di Order.qrisDeclaredAt agar pemilik bisa mencocokkan
 *          dengan notifikasi GoPay Merchant dan menandai bila ternyata
 *          dana tidak kunjung masuk.
 *        - Mode MANUAL (QRIS_STATIS_AUTO_CONFIRM=false): pesanan menunggu
 *          verifikasi admin/owner di Profil ▸ Pengelola QRIS.
 *   2. Webhook layanan mutasi dana -> /api/webhooks/qris-statis.
 *
 * Izin: pemilik pesanan (aplikasi pelanggan) atau admin/kasir.
 */
export async function POST(_req: NextRequest, { params }: Params) {
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

  if (order.paymentMethod !== "QRIS") {
    return NextResponse.json(
      { error: "Pesanan ini bukan pembayaran QRIS." },
      { status: 400 }
    );
  }
  if (order.qrisProvider !== "statis") {
    return NextResponse.json(
      {
        error:
          "Pernyataan bayar hanya untuk QRIS statis toko. Penyedia gateway memverifikasi dana otomatis.",
      },
      { status: 400 }
    );
  }
  if (order.paymentStatus === "PAID") {
    return NextResponse.json({
      paymentStatus: "PAID",
      verified: true,
      already: true,
      paidAt: order.paidAt?.toISOString() ?? null,
      status: order.status,
    });
  }
  if (order.status === "CANCELLED") {
    return NextResponse.json(
      { error: "Pesanan ini sudah dibatalkan.", cancelled: true },
      { status: 400 }
    );
  }

  // Kode bayar kedaluwarsa -> batal otomatis dulu (5 menit berlaku juga di sini)
  const expired = await cancelQrisOrderIfExpired(order);
  if (expired.cancelled) {
    return NextResponse.json(
      {
        error: `Waktu pembayaran QRIS (${QRIS_STATIS_TTL_MINUTES} menit) sudah habis — pesanan dibatalkan otomatis.`,
        cancelled: true,
      },
      { status: 400 }
    );
  }

  // ==== Catat deklarasi pelanggan (jejak untuk pencocokan dana) ====
  await db.order.update({
    where: { id: order.id },
    data: { qrisDeclaredAt: new Date() },
  });

  // ==== Mode AUTO: verifikasi otomatis — sistem melunaskan sekarang ====
  if (QRIS_STATIS_AUTO_CONFIRM) {
    const { already, cancelled, order: updated } = await markOrderPaidBySystem(order.id);
    if (cancelled) {
      return NextResponse.json(
        { error: "Pesanan sudah dibatalkan otomatis.", cancelled: true },
        { status: 409 }
      );
    }
    return NextResponse.json({
      paymentStatus: "PAID",
      verified: true,
      already,
      paidAt: updated.paidAt?.toISOString() ?? null,
      paidVia: updated.paidVia,
      status: updated.status,
      message:
        "Pembayaran terverifikasi otomatis — terima kasih! Dana masuk langsung ke QRIS toko.",
    });
  }

  // ==== Mode MANUAL: tunggu verifikasi admin di Pengelola QRIS ====
  return NextResponse.json({
    paymentStatus: "UNPAID",
    awaiting: true,
    declaredAt: new Date().toISOString(),
    message: `Deklarasi diterima. Petugas akan memverifikasi dana ${formatIDR(
      order.total
    )} di aplikasi QRIS toko — pesanan diproses setelah terverifikasi.`,
  });
}
