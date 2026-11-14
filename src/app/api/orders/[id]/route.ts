import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { ORDER_STATUS_FLOW } from "@/lib/types";
import { awardPointsForOrderCompletion } from "@/lib/points";
import { notifyOrderStatus, notifyCourierOnTheWay, notifyCourierAssigned } from "@/lib/push";
import { isDigitalPayment } from "@/lib/payments";
import { codCompletionMarking, courierCompleteDecision } from "@/lib/courier-setoran";

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
  if (!user) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const body = await req.json();

    // ===== KURIR: "Sampai Tujuan" — selesaikan pesanan antarnya sendiri =====
    // Tombol di beranda kurir kini BENAR-BENAR berfungsi (dulu selalu 403
    // karena kurir tidak masuk daftar role yang diizinkan). Kurir hanya
    // boleh menandai COMPLETED pesanan ANTAR miliknya yang sedang READY —
    // pesanan lain & perubahan lain tetap ditolak. Pesanan antar tunai
    // (COD / bayar di tempat) yang belum lunas otomatis dilunasi dengan
    // paidVia "COD" — uang berpindah ke tangan kurir, wajib disetor ke
    // admin lewat fitur Setoran COD (lihat src/lib/courier-setoran.ts).
    if (user.role === "COURIER") {
      const order = await db.order.findUnique({ where: { id } });
      const decision = courierCompleteDecision(user, order, body);
      if (!decision.ok) {
        return NextResponse.json({ error: decision.error }, { status: decision.code });
      }
      const marking = codCompletionMarking(order!);
      const updated = await db.$transaction(async (tx) => {
        const updatedOrder = await tx.order.update({
          where: { id },
          data: { status: "COMPLETED", ...(marking ?? {}) },
          include: { items: true },
        });
        // Poin member tetap masuk normal saat kurir menyelesaikan pesanan
        await awardPointsForOrderCompletion(tx, order!);
        return updatedOrder;
      });
      // 🔔 Push update status ke perangkat pelanggan pemilik pesanan
      after(() => notifyOrderStatus(id, "COMPLETED"));
      return NextResponse.json({ order: updated });
    }

    if (!isAdminRole(user.role) && user.role !== "CASHIER") {
      return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
    }

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
    // Staff menugaskan kurir saat pesanan READY → onTheWayAt terisi sebagai
    // penanda "sedang diantar"; status pesanan tetap READY (Selesai = tiba
    // di tujuan). Bisa diulang bila kurir ganti.
    // Dua mode penugasan:
    //  a) courierUserId = id AKUN KURIR (role COURIER) → nama & no. HP diambil
    //     dari akun; kurir otomatis melihat pesanan ini (alamat akurat + pin
    //     GPS rumah pelanggan) di beranda kurirnya + push FCM tugas baru.
    //  b) courierName bebas (kurir luar tanpa akun) — perilaku lama.
    if (body?.courierUserId !== undefined || body?.courierName !== undefined) {
      let courierName: string | null = body?.courierName != null ? String(body.courierName).trim().slice(0, 60) : null;
      let courierPhone: string | null = body?.courierPhone != null ? String(body.courierPhone).trim().slice(0, 20) : null;
      let courierUserId: string | null = null;

      if (body?.courierUserId) {
        const courier = await db.user.findUnique({
          where: { id: String(body.courierUserId) },
          select: { id: true, name: true, phone: true, role: true },
        });
        if (!courier || courier.role !== "COURIER") {
          return NextResponse.json({ error: "Akun kurir tidak ditemukan." }, { status: 404 });
        }
        courierUserId = courier.id;
        // Nama & HP selalu dari akun — konsisten di Lacak Kurir pelanggan
        courierName = courier.name;
        courierPhone = courier.phone ?? courierPhone;
      }

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
      const updated = await db.order.update({
        where: { id },
        data: { courierName, courierPhone, courierUserId, onTheWayAt: new Date() },
        include: { items: true },
      });
      // 🔔 Push ke pelanggan: pesanan sedang diantar kurir X
      after(() => notifyCourierOnTheWay(id));
      // 🔔 Push ke AKUN KURIR yang ditugaskan: tugas antar baru
      if (courierUserId) {
        after(() => notifyCourierAssigned(id));
      }
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
    after(() => notifyOrderStatus(id, status));

    return NextResponse.json({ order: updated });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
