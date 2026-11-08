import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

/** DELETE /api/auth/biometric/credentials/[id]
 *  Cabut kredensial biometrik milik pengguna (hanya miliknya sendiri). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
    }
    const { id } = await params;
    const existing = await db.biometricCredential.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return NextResponse.json({ error: "Perangkat tidak ditemukan." }, { status: 404 });
    }
    await db.biometricCredential.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "Gagal menghapus perangkat." }, { status: 500 });
  }
}
