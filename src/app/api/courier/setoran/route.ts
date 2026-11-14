import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { COD_PAID_VIA, courierIncomeOf, menuMoneyOf } from "@/lib/courier-setoran";

/**
 * SETORAN UANG COD KURIR (src/lib/courier-setoran.ts = aturan murni).
 *
 * Pembagian uang pesanan antar tunai (COD / bayar di tempat):
 *  - Kurir menerima uang PENUH dari pelanggan (total = menu + ongkir).
 *  - Kurir menyetor ke admin hanya NOMINAL PESANAN (uang menu) = total − ongkir.
 *  - Ongkir (deliveryFee) = PENDAPATAN KURIR — tetap di kurir, tidak ikut
 *    disetor; tercatat di CourierSetoran.ongkir agar tetap transparan.
 *
 * GET  — role COURIER: kantong COD miliknya (uang menu utk disetor + ongkir
 *        pendapatan) + riwayat setoran. Role admin: rekap tertunggak PER
 *        kurir + riwayat semua setoran (untuk sheet "Setoran Kurir" di
 *        Profil admin — konfirmasi lewat PATCH /api/courier/setoran/[id]).
 * POST — role COURIER: "Setor ke Admin" → SEMUA pesanan COD tertunggak
 *        kurir diikat ke satu CourierSetoran (codSetoranId terisi) sehingga
 *        jumlah uang yang harus disetor kembali ke 0; ongkir tetap milik
 *        kurir.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  // ===== KURIR: kantong COD miliknya sendiri =====
  if (user.role === "COURIER") {
    const pendingOrders = await db.order.findMany({
      where: { courierUserId: user.id, paidVia: COD_PAID_VIA, codSetoranId: null },
      select: {
        id: true,
        code: true,
        total: true,
        deliveryFee: true,
        customerName: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });
    const amount = pendingOrders.reduce((sum, o) => sum + menuMoneyOf(o), 0);
    const ongkir = pendingOrders.reduce((sum, o) => sum + courierIncomeOf(o), 0);
    const riwayat = await db.courierSetoran.findMany({
      where: { courierUserId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return NextResponse.json({
      role: "COURIER",
      pending: { amount, ongkir, count: pendingOrders.length, orders: pendingOrders },
      riwayat,
    });
  }

  // ===== ADMIN: rekap semua kurir =====
  if (!isAdminRole(user.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  // Nominal setoran = total − ongkir per pesanan → agregasi dihitung di
  // sisi aplikasi (pesanan COD tertunggak jumlahnya kecil).
  const pendingOrders = await db.order.findMany({
    where: { paidVia: COD_PAID_VIA, codSetoranId: null, courierUserId: { not: null } },
    select: { courierUserId: true, total: true, deliveryFee: true },
  });
  const map = new Map<string, { amount: number; ongkir: number; count: number }>();
  for (const o of pendingOrders) {
    const key = o.courierUserId as string;
    const cur = map.get(key) ?? { amount: 0, ongkir: 0, count: 0 };
    cur.amount += menuMoneyOf(o);
    cur.ongkir += courierIncomeOf(o);
    cur.count += 1;
    map.set(key, cur);
  }
  const ids = [...map.keys()];
  const couriers = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const perKurir = ids.map((id) => ({
    courierId: id,
    courierName: couriers.find((c) => c.id === id)?.name ?? "Kurir terhapus",
    amount: map.get(id)!.amount,
    ongkir: map.get(id)!.ongkir,
    count: map.get(id)!.count,
  }));
  const riwayat = await db.courierSetoran.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { courier: { select: { name: true } } },
  });
  return NextResponse.json({ role: "ADMIN", perKurir, riwayat });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "COURIER") {
    return NextResponse.json({ error: "Hanya kurir yang bisa menyetor." }, { status: 403 });
  }
  let note: string | null = null;
  try {
    const body = (await req.json()) as { note?: unknown };
    if (typeof body?.note === "string" && body.note.trim()) {
      note = body.note.trim().slice(0, 120);
    }
  } catch {
    // tanpa body — setoran tanpa catatan
  }

  const result = await db.$transaction(async (tx) => {
    // Kunci: hitung ulang tertunggak DI DALAM transaksi (tanpa double-setor
    // bila tombol ditekan dua kali / perangkat lain menyetor bersamaan)
    const pending = await tx.order.findMany({
      where: { courierUserId: user.id, paidVia: COD_PAID_VIA, codSetoranId: null },
      select: { id: true, total: true, deliveryFee: true },
    });
    if (pending.length === 0) {
      return { empty: true as const };
    }
    // Disetor ke admin = uang MENU (total − ongkir); ongkir = pendapatan kurir
    const amount = pending.reduce((sum, o) => sum + menuMoneyOf(o), 0);
    const ongkir = pending.reduce((sum, o) => sum + courierIncomeOf(o), 0);
    const setoran = await tx.courierSetoran.create({
      data: {
        courierUserId: user.id,
        amount,
        ongkir,
        orderCount: pending.length,
        note,
      },
    });
    await tx.order.updateMany({
      where: { id: { in: pending.map((o) => o.id) } },
      data: { codSetoranId: setoran.id },
    });
    return {
      empty: false as const,
      setoran: { ...setoran, orderIds: pending.map((o) => o.id) },
    };
  });

  if (result.empty) {
    return NextResponse.json(
      { error: "Tidak ada uang COD yang perlu disetor." },
      { status: 400 }
    );
  }
  return NextResponse.json({ setoran: result.setoran });
}
