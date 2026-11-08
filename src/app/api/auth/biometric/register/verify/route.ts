import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  deviceLabelFromUA,
  publicKeyToBase64,
  regChallengeKey,
  rpFromRequest,
  takeChallengeEntry,
} from "@/lib/biometric";

/** POST /api/auth/biometric/register/verify
 *  Verifikasi respons authenticator, lalu simpan KUNCI PUBLIK kredensial.
 *  expectedOrigin/expectedRPID dipakai dari nilai tersimpan saat challenge
 *  dibuat (origin persis yang dilihat browser) — bukan tebakan dari header. */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
    }
    const entry = await takeChallengeEntry(regChallengeKey(user.id));
    if (!entry) {
      return NextResponse.json(
        { error: "Sesi pendaftaran kedaluwarsa — coba lagi ya." },
        { status: 400 }
      );
    }
    const body = (await req.json()) as RegistrationResponseJSON;
    const headerRp = rpFromRequest(req);

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: entry.challenge,
      expectedOrigin: entry.origin ?? headerRp.origin,
      expectedRPID: entry.rpId ?? headerRp.rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json(
        { error: "Verifikasi biometrik gagal — coba daftar ulang." },
        { status: 400 }
      );
    }

    const info = verification.registrationInfo;
    const label = deviceLabelFromUA(req.headers.get("user-agent"));

    const credential = await db.biometricCredential.upsert({
      where: { id: info.credential.id },
      create: {
        id: info.credential.id,
        userId: user.id,
        publicKey: publicKeyToBase64(info.credential.publicKey),
        counter: info.credential.counter,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        transports: info.credential.transports?.join(",") ?? null,
        rpId: entry.rpId ?? headerRp.rpID,
        label,
      },
      update: {
        publicKey: publicKeyToBase64(info.credential.publicKey),
        counter: info.credential.counter,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        transports: info.credential.transports?.join(",") ?? null,
        rpId: entry.rpId ?? headerRp.rpID,
        label,
      },
    });

    return NextResponse.json({
      verified: true,
      credentialId: credential.id,
      label: credential.label,
    });
  } catch {
    return NextResponse.json({ error: "Verifikasi pendaftaran biometrik gagal." }, { status: 500 });
  }
}
