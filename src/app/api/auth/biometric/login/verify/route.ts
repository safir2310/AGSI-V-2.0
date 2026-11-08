import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AUTH_DISCOVER_KEY,
  authChallengeKey,
  base64ToUint8Array,
  rpFromRequest,
  takeChallengeEntry,
} from "@/lib/biometric";

/** POST /api/auth/biometric/login/verify
 *  Verifikasi tanda tangan biometrik → buat sesi seperti login biasa. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AuthenticationResponseJSON;
    const credentialId = String(body.id ?? body.rawId ?? "");
    if (!credentialId) {
      return NextResponse.json({ error: "Respons biometrik tidak valid." }, { status: 400 });
    }

    const credential = await db.biometricCredential.findUnique({
      where: { id: credentialId },
      include: { user: true },
    });
    if (!credential) {
      return NextResponse.json(
        { error: "Perangkat biometrik tidak dikenali — masuk pakai email & password dulu ya." },
        { status: 401 }
      );
    }

    // Challenge bisa disimpan per user (login dengan email) atau global (passkey discoverable)
    const userEntry = await takeChallengeEntry(authChallengeKey(credential.userId));
    const entry = userEntry ?? (await takeChallengeEntry(AUTH_DISCOVER_KEY));
    if (!entry) {
      return NextResponse.json(
        { error: "Sesi biometrik kedaluwarsa — coba lagi ya." },
        { status: 400 }
      );
    }

    // expectedOrigin/expectedRPID = nilai persis yang dilihat browser saat
    // challenge dibuat (fallback: rpID kredensial, lalu derivasi header).
    const headerRp = rpFromRequest(req);
    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: entry.challenge,
      expectedOrigin: entry.origin ?? headerRp.origin,
      expectedRPID: entry.rpId ?? credential.rpId ?? headerRp.rpID,
      requireUserVerification: true,
      credential: {
        id: credential.id,
        publicKey: base64ToUint8Array(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports
          ? (credential.transports.split(",") as AuthenticatorTransportFuture[])
          : undefined,
      },
    });

    if (!verification.verified) {
      return NextResponse.json({ error: "Verifikasi biometrik gagal." }, { status: 401 });
    }

    // Counter baru disimpan (anti-replay) + catat pemakaian terakhir
    await db.biometricCredential.update({
      where: { id: credential.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    });

    const token = await createSession(credential.user.id);
    const user = credential.user;
    return NextResponse.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        points: user.points,
        dataConsentAt: user.dataConsentAt ? user.dataConsentAt.toISOString() : null,
        dataConsentVersion: user.dataConsentVersion,
        appTermsAt: user.appTermsAt ? user.appTermsAt.toISOString() : null,
        appTermsVersion: user.appTermsVersion,
      },
    });
  } catch {
    return NextResponse.json({ error: "Verifikasi login biometrik gagal." }, { status: 500 });
  }
}
