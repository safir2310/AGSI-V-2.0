import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { encryptTotpSecret, generateTotpSecret, totpUri } from "@/lib/totp";

/**
 * POST /api/auth/totp/setup — mulai pemasangan authenticator.
 * Membuat secret BARU (menimpa secret pending sebelumnya), disimpan terenkripsi
 * dengan totpEnabledAt masih null. Aktif baru terjadi setelah POST /verify cocok.
 * Respons memuat otpauth:// URI (untuk QR) + secret Base32 (input manual) —
 * satu-satunya saat secret polos dikirim ke klien.
 */
export async function POST() {
  try {
    const me = await getCurrentUser();
    if (!me) {
      return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
    }
    const secret = generateTotpSecret();
    await db.user.update({
      where: { id: me.id },
      data: { totpSecretEnc: encryptTotpSecret(secret), totpEnabledAt: null },
    });
    return NextResponse.json({
      ok: true,
      otpauthUri: totpUri("AGSI", me.email, secret),
      secret,
    });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
