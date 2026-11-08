import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";

/**
 * GET /api/chat/unread — jumlah pesan chat yang belum dibaca (ringan, untuk badge).
 *   - Admin/owner: total pesan pelanggan yang belum dibaca (semua utas).
 *   - Pelanggan/kasir: jumlah balasan CS yang belum dibaca di utas sendiri.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
  }

  if (isAdminRole(user.role)) {
    const agg = await db.chatThread.aggregate({
      _sum: { unreadAdmin: true },
    });
    return NextResponse.json({ unread: agg._sum.unreadAdmin ?? 0 });
  }

  const own = await db.chatThread.findUnique({
    where: { userId: user.id },
    select: { unreadCustomer: true },
  });
  return NextResponse.json({ unread: own?.unreadCustomer ?? 0 });
}
