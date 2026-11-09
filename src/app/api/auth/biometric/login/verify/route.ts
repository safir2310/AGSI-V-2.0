import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  authChallengeKey,
  base64ToUint8Array,
  rpFromRequest,
  takeChallengeEntry,
  type ChallengeEntry,
} from "@/lib/biometric";

/** POST /api/auth/biometric/login/verify
 *  Verifikasi tanda tangan biometrik → buat sesi seperti login biasa.
 *  Klien baru mengirim `challengeKey` (kunci challenge yang diterima dari
 *  /options) supaya alur bersamaan (passkey autofill + tombol) tidak saling
 *  menimpa; klien lama tetap dilayani lewat fallback per-user / discoverable. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AuthenticationResponseJSON & {
      challengeKey?: unknown;
    };
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

    // 1) Klien baru: kunci challenge PERSIS dari respons /options.
    let entry: ChallengeEntry | null = null;
    if (typeof body.challengeKey === "string" && body.challengeKey.startsWith("auth:")) {
      entry = await takeChallengeEntry(body.challengeKey);
    }
    // 2) Fallback klien lama (login dengan email): challenge per user.
    entry = entry ?? (await takeChallengeEntry(authChallengeKey(credential.userId)));
    // 3) Fallback terakhir (klien lama, passkey discoverable): challenge
    //    discoverable terbaru yang masih hidup.
    if (!entry) {
      const latest = await db.biometricChallenge.findFirst({
        where: { key: { startsWith: "auth:discover" }, expiresAt: { gt: new Date() } },
        // TTL konstan 5 menit → expiresAt terjauh = challenge terbaru dibuat
        orderBy: { expiresAt: "desc" },
      });
      if (latest) {
        // Sekali pakai — hapus segera seperti takeChallengeEntry
        await db.biometricChallenge.delete({ where: { key: latest.key } }).catch(() => undefined);
        if (latest.expiresAt.getTime() > Date.now()) {
          entry = { challenge: latest.challenge, rpId: latest.rpId, origin: latest.origin };
        }
      }
    }
    if (!entry) {
      return NextResponse.json(
        { error: "Sesi biometrik kedaluwarsa — coba lagi ya." },
        { status: 400 }
      );
    }

    // expectedOrigin/expectedRPID = nilai persis yang dilihat browser saat
    // challenge dibuat (fallback: rpID kredensial, lalu derivasi header).
    // Library melempar Error saat challenge/origin/rpID tak cocok — ubah
    // menjadi penolakan 401 yang benar (bukan 500 "kesalahan server").
    let verification;
    try {
      const headerRp = rpFromRequest(req);
      verification = await verifyAuthenticationResponse({
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
    } catch {
      return NextResponse.json({ error: "Verifikasi biometrik gagal." }, { status: 401 });
    }

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
  } catch (err) {
    // Diagnostik: detail error ke log server (tanpa bocor data pengguna)
    console.error("[biometric/login/verify]", err);
    return NextResponse.json({ error: "Verifikasi login biometrik gagal." }, { status: 500 });
  }
}
