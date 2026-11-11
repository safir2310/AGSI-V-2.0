import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { ORDER_STATUS_FLOW } from "@/lib/types";
import { awardPointsForOrderCompletion } from "@/lib/points";
import { notifyOrderStatus, notifyCourierOnTheWay } from "@/lib/push";
import { isDigitalPayment } from "@/lib/payments";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const order = await db.order.findUnique({ where: { id }, include: { items: true } });
  if (!order) {
    return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  }
  return NextResponse.json({ order });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || (!isAdminRole(user.role) && user.role !== "CASHIER")) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const body = await req.json();

    // ===== Tandai pembayaran LUNAS =====
    if (body?.paymentStatus === "PAID") {
      const order = await db.order.findUnique({ where: { id } });
      if (!order) {
        return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
      }
      if (order.paymentStatus === "PAID") {
        const paid = await db.order.findUnique({ where: { id }, include: { items: true } });
        return NextResponse.json({ order: paid, already: true });
      }
      // >>> KEBIJAKAN PEMBAYARAN DIGITAL: pelunasan HANYA oleh sistem saat
      // uang masuk <<< Kasir/admin tidak diizinkan menandai lunas pesanan
      // digital (QRIS / E-Wallet) secara manual.
      if (isDigitalPayment(order.paymentMethod)) {
        return NextResponse.json(
          {
            error:
              "Pembayaran digital (QRIS / E-Wallet) tidak bisa ditandai lunas manual. Sistem memverifikasi otomatis saat dana masuk dari penyedia pembayaran.",
          },
          { status: 403 }
        );
      }
      const updated = await db.order.update({
        where: { id },
        data: { paymentStatus: "PAID", paidAt: new Date(), paidVia: "CASH" },
        include: { items: true },
      });
      return NextResponse.json({ order: updated });
    }

    // ===== Serahkan pesanan ANTAR ke kurir AGSI (fitur Lacak Kurir) =====
    // Staff mengisi nama kurir (no. HP opsional) saat pesanan READY →
    // onTheWayAt terisi sebagai penanda "sedang diantar"; status pesanan
    // tetap READY (Selesai = tiba di tujuan). Bisa diulang bila kurir ganti.
    if (body?.courierName !== undefined) {
      const courierName = String(body.courierName ?? "").trim().slice(0, 60);
      if (!courierName) {
        return NextResponse.json({ error: "Nama kurir wajib diisi." }, { status: 400 });
      }
      const order = await db.order.findUnique({ where: { id } });
      if (!order) {
        return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
      }
      if (order.type !== "DELIVERY") {
        return NextResponse.json({ error: "Fitur kurir hanya untuk pesanan antar." }, { status: 400 });
      }
      if (order.status !== "READY") {
        return NextResponse.json(
          { error: "Kurir berangkat setelah pesanan Siap. Tandai Siap dulu ya." },
          { status: 400 }
        );
      }
      const courierPhone = String(body.courierPhone ?? "").trim().slice(0, 20) || null;
      const updated = await db.order.update({
        where: { id },
        data: { courierName, courierPhone, onTheWayAt: new Date() },
        include: { items: true },
      });
      // 🔔 Push ke pelanggan: pesanan sedang diantar kurir X
      void notifyCourierOnTheWay(id);
      return NextResponse.json({ order: updated });
    }

    const { status } = body;
    const order = await db.order.findUnique({ where: { id } });
    if (!order) {
      return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
    }
    const allowed = ORDER_STATUS_FLOW[order.status] ?? [];
    if (!allowed.includes(status)) {
      return NextResponse.json(
        { error: `Status tidak bisa diubah dari ${order.status} ke ${status}.` },
        { status: 400 }
      );
    }

    const updated = await db.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: { status },
        include: { items: true },
      });

      // Pesanan SELESAI → poin member masuk otomatis (1 poin per Rp 1.000,
      // idempoten — pesanan yang sama tidak akan menghasilkan poin dua kali)
      if (status === "COMPLETED") {
        await awardPointsForOrderCompletion(tx, order);
      }

      // Pesanan dibatalkan → kembalikan voucher pelanggan (bisa dipakai lagi)
      if (status === "CANCELLED" && order.voucherCode) {
        const redemption = await tx.voucherRedemption.findUnique({
          where: { orderId: id },
        });
        if (redemption) {
          await tx.voucherRedemption.delete({ where: { id: redemption.id } });
          await tx.voucher.update({
            where: { id: redemption.voucherId },
            data: { usedCount: { decrement: 1 } },
          });
        }
      }

      return updatedOrder;
    });

    // 🔔 Push update status ke perangkat pelanggan pemilik pesanan
    void notifyOrderStatus(id, status);

    return NextResponse.json({ order: updated });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
