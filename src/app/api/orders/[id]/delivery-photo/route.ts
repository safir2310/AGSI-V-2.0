import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { decodeStoredMedia } from "@/lib/serve-image";

/**
 * BUKTI FOTO PENGIRIMAN (permintaan pemilik) — satu foto per pesanan antar.
 *
 * PUT  — kurir yang DITUGASKAN mengunggah/ganti foto bukti (±100–200 KB,
 *        dikompresi di perangkat). Wajib sebelum "Sampai Tujuan" (guard di
 *        PUT status COMPLETED). Pesanan harus masih READY (antaran aktif).
 * GET  — pemilik pesanan, kurir yang ditugaskan, atau admin/kasir:
 *        menyajikan bytes gambar (pola serve-image, tahan data-URL lama).
 *
 * Datanya di tabel DeliveryPhoto (terpisah dari Order) supaya daftar pesanan
 * tetap ringan; Order.deliveryPhotoAt hanya penanda ringan "sudah ada".
 */

type Params = { params: Promise<{ id: string }> };

/** Batas base64: ±1 MB biner — klien mengompres jauh di bawah ini. */
const MAX_DATA_URL = 1_400_000;
const ALLOWED = /^data:(image\/(?:jpeg|png|webp));base64,[A-Za-z0-9+/=]+$/;

/** Kurir yang ditugaskan pada pesanan ini? */
function isAssignedCourier(
  user: { id: string; role: string },
  order: { courierUserId: string | null } | null,
): boolean {
  return !!order?.courierUserId && order.courierUserId === user.id;
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Masuk dulu." }, { status: 401 });
  }
  const { id } = await params;

  let body: { image?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }
  const image = typeof body.image === "string" ? body.image : "";
  if (!ALLOWED.test(image)) {
    return NextResponse.json(
      { error: "Foto harus JPEG/PNG/WebP dari kamera atau galeri." },
      { status: 400 },
    );
  }
  if (image.length > MAX_DATA_URL) {
    return NextResponse.json(
      { error: "Foto terlalu besar — ulangi pengambilan foto." },
      { status: 413 },
    );
  }

  const order = await db.order.findUnique({
    where: { id },
    select: { id: true, courierUserId: true, status: true, type: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  }
  if (!isAssignedCourier(user, order)) {
    return NextResponse.json({ error: "Pesanan bukan tugas antaranmu." }, { status: 403 });
  }
  if (order.type !== "DELIVERY") {
    return NextResponse.json({ error: "Bukti foto hanya untuk pesanan antar." }, { status: 400 });
  }
  if (order.status !== "READY") {
    return NextResponse.json(
      { error: "Antaran sudah selesai — foto tidak bisa diunggah lagi." },
      { status: 409 },
    );
  }

  const mime = image.slice(5, image.indexOf(";"));
  const now = new Date();
  const [photo] = await db.$transaction([
    db.deliveryPhoto.upsert({
      where: { orderId: id },
      create: {
        orderId: id,
        data: image,
        mime,
        uploadedAt: now,
        uploadedByUserId: user.id,
        uploadedByName: user.name ?? "Kurir AGSI",
      },
      update: {
        data: image,
        mime,
        uploadedAt: now,
        uploadedByUserId: user.id,
        uploadedByName: user.name ?? "Kurir AGSI",
      },
    }),
    db.order.update({ where: { id }, data: { deliveryPhotoAt: now } }),
  ]);

  return NextResponse.json({
    ok: true,
    uploadedAt: photo.uploadedAt,
  });
}

export async function GET(_req: NextRequest, { params }: Params) {
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
      courierUserId: true,
      deliveryPhotoAt: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  }
  const allowed =
    (order.userId && order.userId === user.id) ||
    isAssignedCourier(user, order) ||
    isAdminRole(user.role) ||
    user.role === "CASHIER";
  if (!allowed) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  if (!order.deliveryPhotoAt) {
    return NextResponse.json({ error: "Belum ada bukti foto." }, { status: 404 });
  }

  const photo = await db.deliveryPhoto.findUnique({ where: { orderId: id } });
  const dec = photo ? decodeStoredMedia(photo.data, photo.mime, "image") : null;
  if (!dec) {
    return NextResponse.json({ error: "Belum ada bukti foto." }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(dec.buf), {
    status: 200,
    headers: {
      "Content-Type": dec.contentType,
      "Content-Length": String(dec.buf.byteLength),
      // Foto bisa diganti kurir selama antaran aktif → jangan cache lama
      "Cache-Control": "no-store",
    },
  });
}
