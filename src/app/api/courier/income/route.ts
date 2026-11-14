import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { HIDDEN_UNPAID_APP_QRIS_WHERE } from "@/lib/order-expiry";
import { wibDayBounds } from "@/lib/courier-income";

/**
 * GET /api/courier/income — PENDAPATAN & RIWAYAT PENGANTARAN KURIR
 * (khusus role COURIER).
 *
 * Pendapatan = total ONGKIR (deliveryFee) pesanan ANTAR milik kurir ini
 * yang sudah "Sampai Tujuan" (COMPLETED) — ongkir adalah pendapatan
 * kurir, tidak ikut disetor ke admin (lihat src/lib/courier-setoran.ts).
 * Waktu selesai diproksikan `updatedAt` saat status berubah COMPLETED.
 *
 * Batas hari memakai WIB (Asia/Jakarta, UTC+7) — konsisten untuk semua
 * kurir di Sigli/Pidie meski jam perangkat mereka salah set.
 *
 * Respons:
 *  - today     : { amount, count } — selesai hari ini (00:00 WIB ke atas)
 *  - yesterday : { amount, count } — selesai kemarin (00:00–24:00 WIB)
 *  - history   : 30 pengantaran terakhir (terbaru dulu) utk sheet
 *                "Riwayat Pengantaran" di beranda kurir
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "COURIER") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { startOfTodayUtc, startOfYesterdayUtc, endOfTodayUtc } = wibDayBounds(new Date());

  const base = {
    courierUserId: user.id,
    type: "DELIVERY" as const,
    status: "COMPLETED" as const,
    NOT: HIDDEN_UNPAID_APP_QRIS_WHERE,
  };

  const [todayAgg, yesterdayAgg, history] = await Promise.all([
    db.order.aggregate({
      where: { ...base, updatedAt: { gte: startOfTodayUtc, lt: endOfTodayUtc } },
      _sum: { deliveryFee: true },
      _count: true,
    }),
    db.order.aggregate({
      where: { ...base, updatedAt: { gte: startOfYesterdayUtc, lt: startOfTodayUtc } },
      _sum: { deliveryFee: true },
      _count: true,
    }),
    db.order.findMany({
      where: base,
      select: {
        id: true,
        code: true,
        customerName: true,
        deliveryArea: true,
        address: true,
        deliveryFee: true,
        paymentMethod: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
  ]);

  return NextResponse.json({
    today: { amount: todayAgg._sum.deliveryFee ?? 0, count: todayAgg._count },
    yesterday: { amount: yesterdayAgg._sum.deliveryFee ?? 0, count: yesterdayAgg._count },
    history: history.map((o) => ({ ...o, updatedAt: o.updatedAt.toISOString() })),
  });
}
