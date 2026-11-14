import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, hashPassword, verifyPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/password-policy";

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ user });
}

/**
 * PUT /api/auth/me — perbarui profil akun yang sedang masuk.
 * Body: { name, phone?, currentPassword?, newPassword? }
 *
 * - Nama & no. HP bebas diperbarui kapan saja.
 * - Ganti password HANYA bila password sekarang benar (dicek via scrypt).
 * - Email tidak bisa diubah (identitas masuk akun).
 */
export async function PUT(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  }

  try {
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    // phone HANYA diubah bila field dikirim (string kosong = hapus nomor).
    // Bila tidak dikirim sama sekali, nomor lama dipertahankan.
    const phoneSent = body?.phone !== undefined;
    const phone = String(body?.phone ?? "").trim();
    const currentPassword = body?.currentPassword ? String(body.currentPassword) : "";
    const newPassword = body?.newPassword ? String(body.newPassword) : "";

    if (!name) {
      return NextResponse.json({ error: "Nama tidak boleh kosong." }, { status: 400 });
    }
    if (name.length > 60) {
      return NextResponse.json({ error: "Nama maksimal 60 karakter." }, { status: 400 });
    }
    if (phone && !/^[0-9+()\-\s]{6,20}$/.test(phone)) {
      return NextResponse.json({ error: "Nomor HP tidak valid." }, { status: 400 });
    }

    // ===== Ganti password (opsional) =====
    let passwordHash: string | undefined;
    if (newPassword) {
      const pwCheck = validatePassword(newPassword, {
        email: me.email,
        relaxed: me.role === "COURIER",
      });
      if (!pwCheck.ok) {
        return NextResponse.json({ error: pwCheck.error }, { status: 400 });
      }
      const fresh = await db.user.findUnique({
        where: { id: me.id },
        select: { passwordHash: true },
      });
      if (!fresh || !verifyPassword(currentPassword, fresh.passwordHash)) {
        return NextResponse.json(
          { error: "Password sekarang salah — password tidak diganti." },
          { status: 400 }
        );
      }
      passwordHash = hashPassword(newPassword);
    }

    const updated = await db.user.update({
      where: { id: me.id },
      data: {
        name,
        ...(phoneSent ? { phone: phone || null } : {}),
        ...(passwordHash ? { passwordHash } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        points: true,
        // dipertahankan agar state user di klien tidak kehilangan status consent
        dataConsentAt: true,
        dataConsentVersion: true,
        appTermsAt: true,
        appTermsVersion: true,
      },
    });

    return NextResponse.json({
      user: {
        ...updated,
        dataConsentAt: updated.dataConsentAt ? updated.dataConsentAt.toISOString() : null,
        appTermsAt: updated.appTermsAt ? updated.appTermsAt.toISOString() : null,
      },
    });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
