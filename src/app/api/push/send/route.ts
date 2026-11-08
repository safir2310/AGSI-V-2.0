import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { sendTestPush } from "@/lib/push";

/**
 * KIRIM PUSH MANUAL (POST /api/push/send) — hanya ADMIN/OWNER.
 *
 * Body: { scope?: "self" | "staff" | "customers" | "all", title?, body? }
 *   self      → hanya perangkat milik admin yang menekan tombol (uji coba)
 *   staff     → semua admin/owner/kasir
 *   customers → semua pelanggan
 *   all       → semua perangkat terdaftar
 *
 * Bila FCM belum dikonfigurasi (.env kosong), tetap 200 dengan
 * { configured: false } agar UI bisa menampilkan petunjuk — bukan error.
 */

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  }
  if (!isAdminRole(user.role)) {
    return NextResponse.json({ error: "Hanya admin/owner yang bisa mengirim push." }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const raw = String(body?.scope ?? "self");
    const scope = (["self", "staff", "customers", "all"] as const).includes(
      raw as "self" | "staff" | "customers" | "all"
    )
      ? (raw as "self" | "staff" | "customers" | "all")
      : "self";

    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 80) : undefined;
    const text = typeof body?.body === "string" ? body.body.trim().slice(0, 200) : undefined;

    const report = await sendTestPush({
      scope,
      userId: user.id,
      ...(title ? { title } : {}),
      ...(text ? { body: text } : {}),
    });
    return NextResponse.json(report);
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
