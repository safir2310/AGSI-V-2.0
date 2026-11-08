import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { regChallengeKey, rpFromClientOrigin, saveChallenge } from "@/lib/biometric";

/** POST /api/auth/biometric/register/options
 *  Opsi pendaftaran kredensial biometrik untuk perangkat ini (WAJIB sudah login).
 *  Body opsional: { origin } — origin persis yang dilihat browser (window.location.origin).
 *  Browser memvalidasi rp.id terhadap origin halaman, jadi nilai dari browser
 *  lebih benar daripada Host header yang bisa ditulis-ulang proxy/edge. */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as { origin?: unknown };
    const { rpID, origin } = rpFromClientOrigin(body?.origin, req);
    const existing = await db.biometricCredential.findMany({ where: { userId: user.id } });

    const options = await generateRegistrationOptions({
      rpName: "AGSI — Ayam Geprek Sambal Ijo",
      rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({
        id: c.id,
        transports: c.transports
          ? (c.transports.split(",") as AuthenticatorTransportFuture[])
          : undefined,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      // Beri pengguna waktu cukup untuk memindai (default 60 detik terlalu singkat)
      timeout: 120_000,
    });

    await saveChallenge(regChallengeKey(user.id), options.challenge, rpID, origin);
    return NextResponse.json(options);
  } catch {
    return NextResponse.json({ error: "Gagal menyiapkan pendaftaran biometrik." }, { status: 500 });
  }
}
