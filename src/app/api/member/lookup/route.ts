import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";

/**
 * GET /api/member/lookup?code=… — cari member lewat kode member
 * (hasil scan barcode kartu member / ketikan kasir).
 * Hanya untuk kasir & admin (dipakai di POS untuk melampirkan member
 * ke pesanan agar poinnya masuk saat pesanan selesai).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || (!isAdminRole(user.role) && user.role !== "CASHIER")) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  const raw = new URL(req.url).searchParams.get("code") ?? "";
  const code = raw.replace(/\D/g, "");
  if (code.length < 4) {
    return NextResponse.json({ error: "Masukkan kode member (8 digit)." }, { status: 400 });
  }

  const member = await db.user.findUnique({
    where: { memberCode: code },
    select: { name: true, memberCode: true, points: true },
  });
  if (!member) {
    return NextResponse.json({ error: "Kode member tidak ditemukan." }, { status: 404 });
  }

  return NextResponse.json({ member });
}
