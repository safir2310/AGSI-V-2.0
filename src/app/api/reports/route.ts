import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { cancelExpiredQrisOrders, HIDDEN_UNPAID_APP_QRIS_WHERE } from "@/lib/order-expiry";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!isAdminRole(user?.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(90, Math.max(1, Math.round(Number(searchParams.get("days") ?? 7))));

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rangeStart = new Date(startOfToday.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  // Sapu dulu pesanan QRIS kedaluwarsa supaya laporan konsisten dengan daftar pesanan
  try {
    await cancelExpiredQrisOrders();
  } catch {
    // sweep gagal -> laporan tetap dibuat
  }

  // Pesanan QRIS aplikasi yang belum dibayar tidak dihitung — belum "terjadi"
  const [orders, products, users, recent] = await Promise.all([
    db.order.findMany({
      where: { createdAt: { gte: rangeStart }, NOT: HIDDEN_UNPAID_APP_QRIS_WHERE },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
    db.product.findMany(),
    db.user.count({ where: { role: "CUSTOMER" } }),
    db.order.findMany({
      where: { status: { in: ["PENDING", "PREPARING", "READY"] }, NOT: HIDDEN_UNPAID_APP_QRIS_WHERE },
      include: { items: true },
      orderBy: { createdAt: "asc" },
      take: 8,
    }),
  ]);

  const completed = orders.filter((o) => o.status === "COMPLETED");
  const todayOrders = orders.filter(
    (o) => new Date(o.createdAt) >= startOfToday
  );

  const revenueTotal = completed.reduce((s, o) => s + o.total, 0);
  const revenueToday = completed
    .filter((o) => new Date(o.createdAt) >= startOfToday)
    .reduce((s, o) => s + o.total, 0);

  // Grafik harian
  const daily: Array<{ date: string; label: string; revenue: number; orders: number }> = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(rangeStart.getTime() + i * 24 * 60 * 60 * 1000);
    const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    const dayOrders = orders.filter((o) => {
      const t = new Date(o.createdAt);
      return t >= d && t < next;
    });
    daily.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" }),
      revenue: dayOrders.filter((o) => o.status === "COMPLETED").reduce((s, o) => s + o.total, 0),
      orders: dayOrders.length,
    });
  }

  // Penjualan per produk
  const perProduct = new Map<string, { name: string; emoji: string; qty: number; revenue: number }>();
  for (const o of completed) {
    for (const it of o.items) {
      const cur = perProduct.get(it.name) ?? { name: it.name, emoji: it.emoji, qty: 0, revenue: 0 };
      cur.qty += it.qty;
      cur.revenue += it.qty * it.price;
      perProduct.set(it.name, cur);
    }
  }
  const topProducts = Array.from(perProduct.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);

  const statusCount: Record<string, number> = {};
  for (const o of orders) {
    statusCount[o.status] = (statusCount[o.status] ?? 0) + 1;
  }

  const categoryRevenue = new Map<string, number>();
  const productById = new Map(products.map((p) => [p.id, p]));
  for (const o of completed) {
    for (const it of o.items) {
      const cat = (it.productId ? productById.get(it.productId)?.category : null) ?? "Lainnya";
      categoryRevenue.set(cat, (categoryRevenue.get(cat) ?? 0) + it.qty * it.price);
    }
  }

  return NextResponse.json({
    summary: {
      revenueTotal,
      revenueToday,
      ordersTotal: orders.length,
      ordersToday: todayOrders.length,
      completedCount: completed.length,
      cancelledCount: orders.filter((o) => o.status === "CANCELLED").length,
      activeCount: orders.filter((o) => ["PENDING", "PREPARING", "READY"].includes(o.status)).length,
      avgOrder: completed.length > 0 ? Math.round(revenueTotal / completed.length) : 0,
      productCount: products.length,
      availableCount: products.filter((p) => p.available).length,
      customerCount: users,
    },
    daily,
    topProducts,
    statusCount,
    categoryRevenue: Array.from(categoryRevenue.entries()).map(([name, value]) => ({ name, value })),
    recent: recent.map((o) => ({
      id: o.id,
      code: o.code,
      customerName: o.customerName,
      status: o.status,
      type: o.type,
      total: o.total,
      source: o.source,
      createdAt: o.createdAt,
      itemCount: o.items.reduce((s, it) => s + it.qty, 0),
    })),
  });
}
