import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email dan password wajib diisi." },
        { status: 400 }
      );
    }
    const user = await db.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
    if (!user || !verifyPassword(String(password), user.passwordHash)) {
      return NextResponse.json(
        { error: "Email atau password salah." },
        { status: 401 }
      );
    }
    const token = await createSession(user.id);
    return NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        points: user.points,
        // Status persetujuan kebijakan data — popup tampil bila null/versi lama
        dataConsentAt: user.dataConsentAt ? user.dataConsentAt.toISOString() : null,
        dataConsentVersion: user.dataConsentVersion,
        // Status persetujuan syarat & ketentuan aplikasi
        appTermsAt: user.appTermsAt ? user.appTermsAt.toISOString() : null,
        appTermsVersion: user.appTermsVersion,
      },
    });
  } catch (e) {
    // v1.3.38 — jangan gagal diam-diam: catat sebabnya ke log Vercel
    // (mis. P1001 "Can't reach database server" = instance Prisma Postgres
    // pause di console.prisma.io — aktifkan di sana, data & akun utuh).
    console.error(
      "[auth/login] gagal:",
      e instanceof Error ? `${e.message}` : e,
    );
    return NextResponse.json(
      {
        error:
          "Server belum bisa menghubungi basis data — coba lagi beberapa saat. Bila terus, hubungi pengelola (cek /api/health).",
      },
      { status: 500 }
    );
  }
}
