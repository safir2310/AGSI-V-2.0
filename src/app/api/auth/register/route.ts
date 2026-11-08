import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { generateMemberCode } from "@/lib/points";

export async function POST(req: NextRequest) {
  try {
    const { name, email, password, phone } = await req.json();
    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Nama, email, dan password wajib diisi." },
        { status: 400 }
      );
    }
    // No. HP wajib — dipakai untuk verifikasi "lupa password" (6 angka terakhir)
    const phoneDigits = String(phone ?? "").replace(/\D/g, "");
    if (phoneDigits.length < 9) {
      return NextResponse.json(
        { error: "No. HP wajib diisi (minimal 9 angka) — dipakai untuk verifikasi lupa password." },
        { status: 400 }
      );
    }
    if (String(password).length < 6) {
      return NextResponse.json(
        { error: "Password minimal 6 karakter." },
        { status: 400 }
      );
    }
    const normalized = String(email).toLowerCase().trim();
    const existing = await db.user.findUnique({ where: { email: normalized } });
    if (existing) {
      return NextResponse.json(
        { error: "Email sudah terdaftar. Silakan masuk." },
        { status: 409 }
      );
    }
    // Kode member unik (dicoba ulang bila kembar — nyaris mustahil)
    let user: {
      id: string;
      email: string;
      name: string;
      phone: string | null;
      role: string;
      points: number;
      memberCode: string | null;
      dataConsentAt: Date | null;
      dataConsentVersion: string | null;
      appTermsAt: Date | null;
      appTermsVersion: string | null;
    } | null = null;
    for (let attempt = 0; attempt < 6 && !user; attempt++) {
      try {
        user = await db.user.create({
          data: {
            name: String(name).trim(),
            email: normalized,
            passwordHash: hashPassword(String(password)),
            phone: String(phone).trim(),
            role: "CUSTOMER",
            memberCode: generateMemberCode(),
          },
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            role: true,
            points: true,
            memberCode: true,
            dataConsentAt: true,
            dataConsentVersion: true,
            appTermsAt: true,
            appTermsVersion: true,
          },
        });
      } catch {
        // kode member kembar → ulangi dengan kode baru
      }
    }
    if (!user) {
      return NextResponse.json({ error: "Gagal membuat akun. Coba lagi." }, { status: 500 });
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
        memberCode: user.memberCode,
        // Akun baru → null: popup persetujuan kebijakan langsung tampil
        dataConsentAt: user.dataConsentAt ? user.dataConsentAt.toISOString() : null,
        dataConsentVersion: user.dataConsentVersion,
        appTermsAt: user.appTermsAt ? user.appTermsAt.toISOString() : null,
        appTermsVersion: user.appTermsVersion,
      },
    });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
