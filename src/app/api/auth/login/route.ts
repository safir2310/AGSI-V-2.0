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
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
