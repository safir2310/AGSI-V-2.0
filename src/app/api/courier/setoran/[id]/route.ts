import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/courier/setoran/[id] — admin (ADMIN/OWNER/CASHIER) menandai
 * setoran COD kurir sebagai DITERIMA (uang benar-benar di tangan admin).
 * Tidak mengubah jumlah uang — setoran sudah final saat kurir menekan
 * "Setor ke Admin" (POST /api/courier/setoran).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const { id } = await params;
  let confirmed = true;
  try {
    const body = (await req.json()) as { confirmed?: unknown };
    if (typeof body?.confirmed === "boolean") confirmed = body.confirmed;
  } catch {
    // tanpa body — default: konfirmasi diterima
  }
  const existing = await db.courierSetoran.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Setoran tidak ditemukan." }, { status: 404 });
  }
  const setoran = await db.courierSetoran.update({
    where: { id },
    data: { confirmedAt: confirmed ? new Date() : null },
    include: { courier: { select: { name: true } } },
  });
  return NextResponse.json({ setoran });
}
