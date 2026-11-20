import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { geocodeAddress, haversineKm } from "@/lib/geocode";

/**
 * GET /api/orders/[id]/track — DATA PELACAKAN REAL-TIME satu pesanan antar.
 *
 * Dipakai dua arah (permintaan pemilik):
 *  - Pelanggan (pemilik pesanan) memantau posisi KURIR bergerak di peta
 *    (Lacak Kurir) — polling tiap ±6 dtk saat sheet terbuka.
 *  - Kurir yang ditugaskan melihat pin PELANGGAN (GPS checkout; bila kosong
 *    digeokode dari alamat via Nominatim — fallback, bisa null).
 *  - Admin/kasir juga boleh (kebutuhan operasional "di mana kurirnya?").
 *
 * Payload ringan (tanpa item/harga) supaya polling murah:
 * { order:{status,type,onTheWayAt,completedAt?}, courier:{name,phone,lat,lng,locAt},
 *   customerPin:{lat,lng,source}, distanceKm? }
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Masuk dulu." }, { status: 401 });
  }
  const { id } = await params;

  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      type: true,
      status: true,
      onTheWayAt: true,
      courierUserId: true,
      courierName: true,
      courierPhone: true,
      courierLat: true,
      courierLng: true,
      courierLocAt: true,
      deliveryLat: true,
      deliveryLng: true,
      address: true,
      deliveryArea: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  }

  const isOwner = !!order.userId && order.userId === user.id;
  const isAssignedCourier = !!order.courierUserId && order.courierUserId === user.id;
  const isStaff = isAdminRole(user.role) || user.role === "CASHIER";
  if (!isOwner && !isAssignedCourier && !isStaff) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  // Pin pelanggan: utamakan pin GPS presisi dari checkout; bila kosong,
  // geokode alamat (fallback — bisa null → UI pakai tombol Google Maps).
  let customerLat = order.deliveryLat ?? null;
  let customerLng = order.deliveryLng ?? null;
  let pinSource: "gps" | "geocode" | "none" = customerLat != null && customerLng != null ? "gps" : "none";
  if (customerLat == null || customerLng == null) {
    const geo = await geocodeAddress(order.address, order.deliveryArea);
    if (geo) {
      customerLat = geo.lat;
      customerLng = geo.lng;
      pinSource = "geocode";
    }
  }

  const courier = {
    name: order.courierName,
    phone: order.courierPhone,
    lat: order.courierLat,
    lng: order.courierLng,
    locAt: order.courierLocAt,
    onTheWayAt: order.onTheWayAt,
    live: !!order.onTheWayAt && order.status !== "COMPLETED" && order.status !== "CANCELLED",
  };

  const distanceKm =
    courier.lat != null &&
    courier.lng != null &&
    customerLat != null &&
    customerLng != null
      ? haversineKm(
          { lat: courier.lat, lng: courier.lng },
          { lat: customerLat, lng: customerLng },
        )
      : null;

  return NextResponse.json({
    order: { status: order.status, type: order.type, onTheWayAt: order.onTheWayAt },
    courier,
    customerPin:
      customerLat != null && customerLng != null
        ? { lat: customerLat, lng: customerLng, source: pinSource }
        : null,
    distanceKm,
  });
}
