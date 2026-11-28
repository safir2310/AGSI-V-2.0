import { NextRequest, NextResponse } from "next/server";
import { validatePassword } from "@/lib/password-policy";
import { db } from "@/lib/db";
import { deleteUserSessions, hashPassword, verifyPassword } from "@/lib/auth";

/**
 * POST /api/auth/reset-password
 * Langkah 2 alur lupa password: user memasukkan email + kode OTP 6 digit
 * yang dikirim ke emailnya + password baru. Jika cocok, password diganti
 * dan SEMUA sesi lama dihapus supaya dipaksa masuk ulang dengan password baru.
 */
const MAX_ATTEMPTS = 5;

export async function POST(req: NextRequest) {
  try {
    const { email, code, newPassword } = await req.json();
    const normalized = String(email ?? "").toLowerCase().trim();
    const codeStr = String(code ?? "").trim();
    const newPwd = String(newPassword ?? "");

    if (!normalized || !codeStr) {
      return NextResponse.json(
        { error: "Email dan kode OTP wajib diisi." },
        { status: 400 }
      );
    }
    const user = await db.user.findUnique({ where: { email: normalized } });
    if (!user) {
      return NextResponse.json(
        { error: "Email ini belum terdaftar." },
        { status: 404 }
      );
    }

    // Sandi kurir santai (boleh nama/angka berurutan); role lain tetap ketat
    const pwCheck = validatePassword(newPwd, {
      email: normalized,
      relaxed: user.role === "COURIER",
    });
    if (!pwCheck.ok) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    }

    const reset = await db.passwordReset.findFirst({
      where: { email: normalized, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!reset) {
      return NextResponse.json(
        { error: "Sesi verifikasi tidak ditemukan atau sudah kedaluwarsa. Ulangi dari langkah pertama ya." },
        { status: 400 }
      );
    }
    if (reset.attempts >= MAX_ATTEMPTS) {
      await db.passwordReset.deleteMany({ where: { id: reset.id } });
      return NextResponse.json(
        { error: "Terlalu banyak percobaan salah. Ulangi verifikasi dari langkah pertama ya." },
        { status: 429 }
      );
    }

    if (!verifyPassword(codeStr, reset.codeHash)) {
      await db.passwordReset.update({
        where: { id: reset.id },
        data: { attempts: { increment: 1 } },
      });
      return NextResponse.json(
        { error: `Kode OTP tidak cocok. Periksa email lagi ya. Sisa percobaan: ${MAX_ATTEMPTS - reset.attempts - 1}.` },
        { status: 400 }
      );
    }

    // OTP cocok → ganti password, tandai sesi verifikasi terpakai, hapus semua sesi lama
    await db.$transaction([
      db.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      db.user.update({
        where: { id: user.id },
        data: { passwordHash: hashPassword(newPwd) },
      }),
      db.session.deleteMany({ where: { userId: user.id } }),
    ]);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
