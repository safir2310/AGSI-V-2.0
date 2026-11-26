import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/courier/location — kurir mengirim POSISI GPS TERKINI (real-time).
 *
 * Beranda kurir memanggil ini tiap ±8 detik selama ada pengantaran aktif
 * (onTheWayAt terisi, pesanan belum selesai): posisi disimpan ke Order
 * (courierLat/courierLng/courierLocAt) sehingga pelanggan melihat kurir
 * bergerak di peta Lacak Kurir (permintaan pemilik).
 *
 * Keamanan: khusus role COURIER, dan HANYA untuk pesanan yang benar-benar
 * ditugaskan kepadanya (courierUserId = user.id) — kurir lain tidak bisa
 * menulis posisi pada pesanan bukan tanggungannya.
 *
 * Body: { orderId: string, lat: number, lng: number }
 */

function clamp(v: number, min: number, max: number): number | null {
  if (!Number.isFinite(v)) return null;
  if (v < min || v > max) return null;
  return v;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "COURIER") {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  let body: { orderId?: string; lat?: number; lng?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }

  const orderId = typeof body.orderId === "string" ? body.orderId : "";
  const lat = clamp(Number(body.lat), -90, 90);
  const lng = clamp(Number(body.lng), -180, 180);
  if (!orderId || lat == null || lng == null) {
    return NextResponse.json(
      { error: "orderId, lat, dan lng wajib valid." },
      { status: 400 },
    );
  }

  // Pesanan harus milik kurir ini & masih dalam pengantaran
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      courierUserId: true,
      onTheWayAt: true,
      status: true,
      type: true,
    },
  });
  if (!order || order.courierUserId !== user.id) {
    return NextResponse.json(
      { error: "Pesanan bukan tanggungan Anda." },
      { status: 403 },
    );
  }
  if (order.type !== "DELIVERY" || !order.onTheWayAt) {
    return NextResponse.json(
      { error: "Pesanan belum dalam status pengantaran." },
      { status: 409 },
    );
  }
  if (order.status === "COMPLETED" || order.status === "CANCELLED") {
    return NextResponse.json({ ok: true, stale: true });
  }

  await db.order.update({
    where: { id: orderId },
    data: { courierLat: lat, courierLng: lng, courierLocAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
