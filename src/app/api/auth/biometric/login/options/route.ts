import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { AUTH_DISCOVER_KEY, authChallengeKey, rpFromClientOrigin, saveChallenge } from "@/lib/biometric";

/** POST /api/auth/biometric/login/options
 *  Opsi autentikasi biometrik. Body: { email?, origin? }.
 *  - Dengan email    → hanya kredensial akun itu yang diizinkan.
 *  - Tanpa email     → passkey discoverable: pengguna memilih akun di dialog biometrik.
 *  origin = window.location.origin yang dikirim browser — sumber rp.id yang
 *  benar di belakang proxy yang menulis-ulang Host header. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: unknown;
      origin?: unknown;
    };
    const { rpID, origin } = rpFromClientOrigin(body?.origin, req);

    let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] = [];
    let challengeKey = AUTH_DISCOVER_KEY;

    if (body?.email && String(body.email).trim()) {
      const user = await db.user.findUnique({
        where: { email: String(body.email).toLowerCase().trim() },
        include: { biometricCredentials: true },
      });
      if (!user || user.biometricCredentials.length === 0) {
        return NextResponse.json(
          { error: "Belum ada perangkat biometrik terdaftar untuk akun ini." },
          { status: 404 }
        );
      }
      allowCredentials = user.biometricCredentials.map((c) => ({
        id: c.id,
        transports: c.transports
          ? (c.transports.split(",") as AuthenticatorTransportFuture[])
          : undefined,
      }));
      challengeKey = authChallengeKey(user.id);
    }

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: "required",
      // Beri waktu cukup untuk memindai (default 60 detik terlalu singkat)
      timeout: 120_000,
    });

    await saveChallenge(challengeKey, options.challenge, rpID, origin);
    return NextResponse.json(options);
  } catch {
    return NextResponse.json({ error: "Gagal menyiapkan login biometrik." }, { status: 500 });
  }
}
