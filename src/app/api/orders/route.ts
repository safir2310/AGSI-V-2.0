import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { checkVoucherForUser, normalizeVoucherCode } from "@/lib/voucher";
import { cancelExpiredQrisOrders, HIDDEN_UNPAID_APP_QRIS_WHERE } from "@/lib/order-expiry";
import { DELIVERY_AREA_LABEL, calcDeliveryFee, findDeliveryArea } from "@/lib/delivery";
import { getStoreSettings } from "@/lib/store-settings";
import { notifyNewOrder } from "@/lib/push";

function makeOrderCode(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `AGSI-${y}${m}${d}-${rand}`;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope");

  // Sapu dulu pesanan QRIS yang lewat batas 5 menit — biar status daftar
  // selalu segar (dibatalkan otomatis + voucher pelanggan kembali).
  try {
    await cancelExpiredQrisOrders();
  } catch {
    // sweep gagal (mis. DB sibuk) -> jangan gagalkan daftar pesanan
  }

  // Admin/owner/kasir melihat semua pesanan — KECUALI pesanan QRIS aplikasi
  // yang belum dibayar: pesanan belum "masuk" sampai dananya terverifikasi.
  // (Pesanan QRIS buatan POS tetap tampil — kasir memantau langsung di kasir.)
  // Customer hanya melihat miliknya sendiri (termasuk yang belum dibayar).
  const where =
    scope === "all" && (isAdminRole(user.role) || user.role === "CASHIER")
      ? { NOT: HIDDEN_UNPAID_APP_QRIS_WHERE }
      : { userId: user.id };

  const orders = await db.order.findMany({
    where,
    include: { items: true, user: { select: { phone: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  // No. HP tampilan: nomor yang diisi saat checkout, fallback ke nomor akun
  // pelanggan (membantu pesanan lama / POS yang menempelkan member).
  return NextResponse.json({
    orders: orders.map(({ user, ...o }) => ({
      ...o,
      userPhone: o.phone ?? user?.phone ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  try {
    const body = await req.json();
    const items: Array<{ productId?: string; name: string; emoji: string; price: number; qty: number; note?: string }> =
      body.items ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Keranjang masih kosong." }, { status: 400 });
    }

    // Validasi & ambil harga asli dari database (jangan percaya harga dari klien)
    const productIds = items.map((it) => it.productId).filter(Boolean) as string[];
    const dbProducts = await db.product.findMany({ where: { id: { in: productIds } } });
    const productMap = new Map(dbProducts.map((p) => [p.id, p]));

    const resolved = items.map((it) => {
      const p = it.productId ? productMap.get(it.productId) : undefined;
      return {
        productId: p?.id ?? null,
        name: p?.name ?? String(it.name ?? "Item"),
        emoji: p?.emoji ?? String(it.emoji ?? "🍗"),
        price: p?.price ?? Math.max(0, Math.round(Number(it.price) || 0)),
        qty: Math.max(1, Math.round(Number(it.qty) || 1)),
        note: it.note ? String(it.note).slice(0, 200) : null,
      };
    });

    const subtotal = resolved.reduce((sum, it) => sum + it.price * it.qty, 0);
    const serviceFee = 0;

    const source = body.source === "POS" ? "POS" : "APP";
    const isPos = source === "POS";
    if (!isPos && !user) {
      return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
    }
    if (isPos && user && !isAdminRole(user.role) && user.role !== "CASHIER") {
      return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
    }

    const now = new Date();
    const type = ["DINE_IN", "TAKEAWAY", "DELIVERY"].includes(body.type) ? body.type : "DINE_IN";

    // ===== SAKLAR LAYANAN TOKO (Profil Admin → Pengaturan Toko) =====
    // Layanan antar & pembayaran QRIS bisa dinonaktifkan admin — selain
    // disembunyikan di UI, checkout juga DITOLAK di sini agar tidak bisa
    // dilewati lewat request langsung ke API.
    const storeSettings = await getStoreSettings();
    if (type === "DELIVERY" && !storeSettings.deliveryEnabled) {
      return NextResponse.json(
        { error: "Layanan antar pesanan sedang dinonaktifkan. Silakan pilih makan di tempat / bungkus." },
        { status: 400 }
      );
    }
    if (
      (body.paymentMethod === "QRIS" || body.paymentMethod === "EWALLET") &&
      !storeSettings.qrisEnabled
    ) {
      return NextResponse.json(
        { error: "Pembayaran digital (QRIS / E-Wallet) sedang dinonaktifkan. Silakan bayar tunai." },
        { status: 400 }
      );
    }

    // ===== ONGKIR PENGANTARAN — Rp1.000/km, kelipatan jarak =====
    // Area alamat hanya melayani Kec. Pidie, Kab. Pidie, Aceh 24151.
    // Ongkir selalu dihitung SERVER-SIDE dari daftar area terdaftar —
    // nominal ongkir dari klien TIDAK dipercaya.
    let deliveryFee = 0;
    let distanceKm: number | null = null;
    let deliveryArea: string | null = null;
    if (type === "DELIVERY") {
      const area = findDeliveryArea(String(body.deliveryAreaId ?? "").trim());
      if (area) {
        deliveryArea = area.gampong;
        distanceKm = area.distanceKm;
        deliveryFee = calcDeliveryFee(area.distanceKm);
      } else if (!isPos) {
        // Aplikasi pelanggan wajib memilih area pengantaran resmi
        return NextResponse.json(
          { error: `Pilih alamat pengantaran di area layanan (${DELIVERY_AREA_LABEL}).` },
          { status: 400 }
        );
      }
      // POS tanpa area terdaftar: ongkir 0 — transaksi langsung di kasir
    }

    // Alamat tersimpan = detail rumah/patokan dari pelanggan + snapshot area
    const addressDetail = body.address ? String(body.address).trim().slice(0, 200) : "";
    const fullAddress =
      type === "DELIVERY" && deliveryArea
        ? [addressDetail, `Gampong ${deliveryArea}`, DELIVERY_AREA_LABEL]
            .filter(Boolean)
            .join(", ")
        : addressDetail || null;

    // ===== Pin GPS lokasi rumah pelanggan (opsional, type DELIVERY) =====
    // Pelanggan menempel pin saat checkout (browser) / menempel link Google
    // Maps — kurir diarahkan PRESISI ke titik ini, bukan cuma nama gampong.
    // Koordinat divalidasi rentangnya; dibulatkan 6 desimal (~0,1 m).
    let deliveryLat: number | null = null;
    let deliveryLng: number | null = null;
    if (type === "DELIVERY" && body.deliveryLat != null && body.deliveryLng != null) {
      const lat = Number(body.deliveryLat);
      const lng = Number(body.deliveryLng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        deliveryLat = Math.round(lat * 1e6) / 1e6;
        deliveryLng = Math.round(lng * 1e6) / 1e6;
      }
    }

    // POS bisa melampirkan member lewat kode member (hasil scan barcode kartu
    // member / ketikan manual) — poin pesanan ini akan masuk ke akun member
    // saat pesanan selesai.
    let memberUserId: string | null = null;
    let memberName: string | null = null;
    if (isPos && body.memberCode) {
      const code = String(body.memberCode).replace(/\D/g, "");
      if (code) {
        const member = await db.user.findUnique({ where: { memberCode: code } });
        if (!member) {
          return NextResponse.json({ error: "Kode member tidak ditemukan." }, { status: 400 });
        }
        memberUserId = member.id;
        memberName = member.name;
      }
    }

    const customerName =
      (body.customerName ? String(body.customerName).trim() : "") ||
      memberName ||
      user?.name ||
      "Pelanggan";

    // Voucher hanya untuk pesanan aplikasi oleh pelanggan yang masuk
    const voucherCode = !isPos && user ? normalizeVoucherCode(body.voucherCode) : "";
    const hasVoucher = !!voucherCode;

    // Validasi dulu di luar transaksi agar pesan errornya jelas & cepat
    if (hasVoucher) {
      const pre = await checkVoucherForUser(voucherCode, user!.id, subtotal);
      if (!pre.ok) {
        return NextResponse.json({ error: pre.error }, { status: 400 });
      }
    }

    const order = await db.$transaction(async (tx) => {
      let voucherDiscount = 0;

      if (hasVoucher) {
        // Validasi ulang DI DALAM transaksi: dua pesanan bersamaan tidak boleh
        // melewati kuota / aturan sekali pakai.
        const check = await checkVoucherForUser(voucherCode, user!.id, subtotal, tx);
        if (!check.ok) {
          throw new Error(check.error);
        }
        voucherDiscount = check.discount;
      }

      const total = Math.max(0, subtotal + serviceFee + deliveryFee - voucherDiscount);

      // Status awal pembayaran:
      //  - total 0 (voucher menutup semua)      -> langsung LUNAS
      //  - POS tunai (uang diterima di kasir)    -> LUNAS
      //  - QRIS / E-Wallet / tunai aplikasi      -> UNPAID (menunggu pelanggan)
      const paymentMethod =
        body.paymentMethod === "QRIS" || body.paymentMethod === "EWALLET"
          ? body.paymentMethod
          : "CASH";
      const paymentStatus =
        total === 0 || (isPos && paymentMethod === "CASH") ? "PAID" : "UNPAID";

      const created = await tx.order.create({
        data: {
          code: makeOrderCode(now),
          userId: isPos ? memberUserId : (user?.id ?? null),
          customerName,
          type,
          tableNo: body.tableNo ? String(body.tableNo).slice(0, 10) : null,
          address: fullAddress,
          deliveryArea,
          distanceKm,
          deliveryFee,
          deliveryLat,
          deliveryLng,
          phone: body.phone ? String(body.phone).slice(0, 20) : null,
          note: body.note ? String(body.note).slice(0, 300) : null,
          status: "PENDING",
          paymentMethod,
          paymentStatus,
          source,
          subtotal,
          serviceFee,
          voucherCode: hasVoucher ? voucherCode : null,
          voucherDiscount,
          total,
          items: { create: resolved },
        },
        include: { items: true },
      });

      // Catat pemakaian voucher (sekali pakai) + naikkan penjumlah pemakaian
      if (hasVoucher) {
        const v = await tx.voucher.findUnique({ where: { code: voucherCode } });
        if (!v) throw new Error("Kode voucher tidak ditemukan.");
        await tx.voucherRedemption.create({
          data: { voucherId: v.id, userId: user!.id, orderId: created.id },
        });
        await tx.voucher.update({
          where: { id: v.id },
          data: { usedCount: { increment: 1 } },
        });
      }

      // CATATAN: poin member TIDAK lagi diberikan saat checkout.
      // Poin masuk otomatis saat pesanan ditandai SELESAI
      // (lihat PUT /api/orders/[id] → status COMPLETED).

      return created;
    });

    // 🔔 Push heads-up ke perangkat staff (admin/owner/kasir). Pesanan QRIS
    // aplikasi yang belum dibayar otomatis dilewati di dalam helper —
    // pemantiknya notifyOrderPaid saat dana terverifikasi masuk.
    void notifyNewOrder(order.id);

    return NextResponse.json({ order });
  } catch (err) {
    // Pesan error validasi voucher dilempar sebagai Error biasa dari transaksi
    if (err instanceof Error && err.message && !err.message.includes("prisma")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
