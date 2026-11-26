import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { decryptTotpSecret, verifyTotpCode } from "@/lib/totp";

/**
 * POST /api/auth/totp/verify — konfirmasi pemasangan authenticator.
 * User memindai QR (setup) lalu mengetik kode 6 digit yang sedang tampil di
 * aplikasi authenticator; cocok → totpEnabledAt diisi = AKTIF. Sejak itu
 * "lupa password" akun ini memakai authenticator (bukan OTP email).
 */
export async function POST(req: NextRequest) {
  try {
    const me = await getCurrentUser();
    if (!me) {
      return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
    }
    const { code } = await req.json().catch(() => ({ code: "" }));
    const user = await db.user.findUnique({
      where: { id: me.id },
      select: { totpSecretEnc: true, totpEnabledAt: true },
    });
    if (!user?.totpSecretEnc) {
      return NextResponse.json(
        { error: "Belum ada pemasangan berjalan — mulai dari tombol Aktifkan Authenticator dulu ya." },
        { status: 400 }
      );
    }
    const secret = decryptTotpSecret(user.totpSecretEnc);
    const check = secret ? verifyTotpCode(secret, String(code ?? "")) : { ok: false };
    if (!check.ok) {
      return NextResponse.json(
        { error: "Kode belum cocok. Pastikan memakai entri AGSI yang baru dipindai & jam perangkatmu akurat." },
        { status: 400 }
      );
    }
    await db.user.update({
      where: { id: me.id },
      data: { totpEnabledAt: new Date() },
    });
    return NextResponse.json({ ok: true, enabled: true });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
