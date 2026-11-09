import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { db } from "@/lib/db";
import { authChallengeKey, newDiscoverKey, rpFromClientOrigin, saveChallenge } from "@/lib/biometric";

/** POST /api/auth/biometric/login/options
 *  Opsi autentikasi biometrik. Body: { email?, origin? }.
 *  - Dengan email    → hanya kredensial akun itu yang diizinkan.
 *  - Tanpa email     → passkey discoverable: pengguna memilih akun di dialog biometrik
 *                      (modal tombol sidik jari ATAU saran autofill passkey).
 *  Respons berisi `challengeKey` — klien baru mengembalikannya saat verify agar
 *  tiap permintaan punya challenge sendiri (dua alur bersamaan tidak menimpa). */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: unknown;
      origin?: unknown;
    };
    const { rpID, origin } = rpFromClientOrigin(body?.origin, req);

    let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] = [];
    // Discoverable → kunci UNIK per permintaan: passkey autofill & tombol
    // sidik jari bisa berjalan bersamaan tanpa saling mengganti challenge.
    let challengeKey = newDiscoverKey();

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
    // Klien baru memakai challengeKey ini saat verify; klien lama tetap dilayani
    // lewat fallback di route verify.
    return NextResponse.json({ ...options, challengeKey });
  } catch {
    return NextResponse.json({ error: "Gagal menyiapkan login biometrik." }, { status: 500 });
  }
}
