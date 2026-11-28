import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { cancelExpiredQrisOrders, HIDDEN_UNPAID_APP_QRIS_WHERE } from "@/lib/order-expiry";

/**
 * GET /api/courier/deliveries — BERANDA KURIR (khusus role COURIER).
 *
 * Daftar pesanan ANTAR (type DELIVERY) yang ditugaskan ke akun kurir ini
 * (courierUserId = id kurir), urut prioritas: yang belum sampai dulu.
 *
 * Keamanan data: kurir hanya melihat pesanan yang benar-benar ditugaskan
 * kepadanya — alamat rumah, pin GPS, dan no. HP pelanggan TIDAK bocor ke
 * pesanan kurir lain. (Data ini memang tujuan fitur: kurir antar ke rumah
 * pelanggan secara akurat.)
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "COURIER") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  // Sapu dulu pesanan QRIS kedaluwarsa supaya daftar selalu segar
  try {
    await cancelExpiredQrisOrders();
  } catch {
    // sweep gagal -> jangan gagalkan daftar pengantaran
  }

  const orders = await db.order.findMany({
    where: {
      courierUserId: user.id,
      type: "DELIVERY",
      status: { in: ["READY", "COMPLETED"] },
      NOT: HIDDEN_UNPAID_APP_QRIS_WHERE,
    },
    include: { items: true },
    orderBy: [{ onTheWayAt: "desc" }, { createdAt: "desc" }],
    take: 60,
  });

  return NextResponse.json({
    courier: { id: user.id, name: user.name },
    orders,
  });
}
