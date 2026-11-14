import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { COD_PAID_VIA } from "@/lib/courier-setoran";

/**
 * SETORAN UANG COD KURIR (src/lib/courier-setoran.ts = aturan murni).
 *
 * GET  — role COURIER: uang COD di tangan (belum disetor) + riwayat setoran
 *        sendiri. Role admin: rekap tertunggak PER kurir + riwayat semua
 *        setoran (untuk kartu "Setoran Kurir" di dashboard admin).
 * POST — role COURIER: "Setor ke Admin" → SEMUA pesanan COD tertunggak
 *        kurir diikat ke satu CourierSetoran (codSetoranId terisi) sehingga
 *        jumlah uang yang harus disetor kembali ke 0; admin tinggal
 *        mengonfirmasi penerimaan (PATCH /api/courier/setoran/[id]).
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
      select: { id: true, code: true, total: true, customerName: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
    const amount = pendingOrders.reduce((sum, o) => sum + o.total, 0);
    const riwayat = await db.courierSetoran.findMany({
      where: { courierUserId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return NextResponse.json({
      role: "COURIER",
      pending: { amount, count: pendingOrders.length, orders: pendingOrders },
      riwayat,
    });
  }

  // ===== ADMIN: rekap semua kurir =====
  if (!isAdminRole(user.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const grouped = await db.order.groupBy({
    by: ["courierUserId"],
    where: { paidVia: COD_PAID_VIA, codSetoranId: null, courierUserId: { not: null } },
    _sum: { total: true },
    _count: { _all: true },
  });
  const ids = grouped.map((g) => g.courierUserId).filter((v): v is string => v != null);
  const couriers = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const perKurir = grouped.map((g) => ({
    courierId: g.courierUserId,
    courierName: couriers.find((c) => c.id === g.courierUserId)?.name ?? "Kurir terhapus",
    amount: g._sum.total ?? 0,
    count: g._count._all,
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
      select: { id: true, total: true },
    });
    if (pending.length === 0) {
      return { empty: true as const };
    }
    const amount = pending.reduce((sum, o) => sum + o.total, 0);
    const setoran = await tx.courierSetoran.create({
      data: {
        courierUserId: user.id,
        amount,
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
