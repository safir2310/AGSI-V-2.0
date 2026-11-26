import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { decryptTotpSecret, verifyTotpCode } from "@/lib/totp";

/**
 * GET /api/auth/totp — status authenticator akun yang sedang login.
 *   { enabled, pending } — enabled = aktif dipakai untuk lupa password;
 *   pending = secret sudah dibuat tapi belum dikonfirmasi dengan kode.
 * DELETE /api/auth/totp — nonaktifkan authenticator; wajib menyertakan kode
 *   yang sedang valid (proteksi: pencuri sesi tidak bisa mematikan 2FA sendiri).
 */
export async function GET() {
  try {
    const me = await getCurrentUser();
    if (!me) {
      return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
    }
    const user = await db.user.findUnique({
      where: { id: me.id },
      select: { totpSecretEnc: true, totpEnabledAt: true },
    });
    return NextResponse.json({
      enabled: !!user?.totpEnabledAt,
      pending: !!user?.totpSecretEnc && !user?.totpEnabledAt,
    });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
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
    if (!user?.totpEnabledAt) {
      return NextResponse.json({ error: "Authenticator memang belum aktif." }, { status: 400 });
    }
    const secret = decryptTotpSecret(user.totpSecretEnc);
    const check = secret ? verifyTotpCode(secret, String(code ?? "")) : { ok: false };
    if (!check.ok) {
      return NextResponse.json(
        { error: "Kode authenticator tidak cocok — authenticator TIDAK dimatikan. Ambil kode terbaru dari aplikasimu." },
        { status: 400 }
      );
    }
    await db.user.update({
      where: { id: me.id },
      data: { totpSecretEnc: null, totpEnabledAt: null },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
