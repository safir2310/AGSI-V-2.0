import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/orders/[id]/pay
 * Pelanggan menekan "Saya Sudah Bayar" setelah memindai QRIS.
 * Status pembayaran berubah UNPAID -> CONFIRMING, lalu kasir/admin
 * memeriksa mutasi dompet dan menandai lunas dari sisi kasir.
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
      { error: "Pesanan ini menggunakan pembayaran tunai." },
      { status: 400 }
    );
  }
  if (order.status === "CANCELLED") {
    return NextResponse.json({ error: "Pesanan ini sudah dibatalkan." }, { status: 400 });
  }

  // Idempoten: sudah diverifikasi / sudah lunas → tidak error
  if (order.paymentStatus === "CONFIRMING" || order.paymentStatus === "PAID") {
    return NextResponse.json({ ok: true, paymentStatus: order.paymentStatus, already: true });
  }

  await db.order.update({ where: { id }, data: { paymentStatus: "CONFIRMING" } });
  return NextResponse.json({ ok: true, paymentStatus: "CONFIRMING" });
}
