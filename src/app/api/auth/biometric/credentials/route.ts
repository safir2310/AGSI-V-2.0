import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

/** GET /api/auth/biometric/credentials
 *  Daftar perangkat biometrik milik pengguna yang sedang masuk. */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
    }
    const credentials = await db.biometricCredential.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({
      credentials: credentials.map((c) => ({
        id: c.id,
        label: c.label,
        deviceType: c.deviceType,
        backedUp: c.backedUp,
        rpId: c.rpId,
        createdAt: c.createdAt.toISOString(),
        lastUsedAt: c.lastUsedAt ? c.lastUsedAt.toISOString() : null,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Gagal memuat daftar perangkat." }, { status: 500 });
  }
}
