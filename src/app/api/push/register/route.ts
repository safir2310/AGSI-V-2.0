import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/**
 * PENDAFTARAN TOKEN PUSH (FCM) per perangkat.
 *
 * POST /api/push/register { token, platform? }   — upsert token perangkat.
 *   Login? token diikat ke akun & role tsb (target push per peran).
 *   Belum login (mis. aplikasi Android baru dibuka)? token disimpan anonim,
 *   lalu DI-IKAT otomatis saat pengguna masuk (AppShell memanggil ulang
 *   endpoint ini lewat jembatan AgsiNative).
 * DELETE /api/push/register { token }            — hapus token (nonaktifkan push).
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token || token.length > 4096) {
      return NextResponse.json({ error: "Token push tidak valid." }, { status: 400 });
    }
    const platform = body?.platform === "android" ? "android" : "web";
    const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 200) || null;
    const user = await getCurrentUser();

    await db.pushToken.upsert({
      where: { token },
      update: {
        userId: user?.id ?? null,
        role: user?.role ?? null,
        platform,
        userAgent,
      },
      create: {
        token,
        userId: user?.id ?? null,
        role: user?.role ?? null,
        platform,
        userAgent,
      },
    });

    return NextResponse.json({
      ok: true,
      boundToUser: !!user,
      platform,
    });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token) {
      return NextResponse.json({ error: "Token push tidak valid." }, { status: 400 });
    }
    await db.pushToken.deleteMany({ where: { token } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
