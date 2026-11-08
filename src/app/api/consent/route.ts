import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { DATA_POLICY_VERSION } from "@/lib/data-policy";
import { APP_TERMS_VERSION } from "@/lib/app-terms";

/**
 * POST /api/consent — catat PERSETUJUAN LEGAL untuk akun yang sedang masuk
 * (semua role). Satu aksi mencatat DUA dokumen sekaligus:
 *   1. Syarat & Ketentuan Penggunaan Aplikasi  (appTermsAt/appTermsVersion)
 *   2. Kebijakan Penggunaan Data               (dataConsentAt/dataConsentVersion)
 *
 * Body: { accepted: true }
 * - Hanya menerima `accepted: true` (penolakan TIDAK menyimpan apa pun;
 *   klien cukup mengeluarkan pengguna dari sesi).
 * - Menyimpan waktu persetujuan + versi dokumen yang berlaku.
 * - Bila versi salah satu dokumen naik, endpoint ini juga dipakai untuk
 *   menyetujui ulang (kedua dokumen diperbarui — aman & idempoten).
 */
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "Silakan masuk." }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || body.accepted !== true) {
      return NextResponse.json(
        { error: "Persetujuan tidak valid." },
        { status: 400 }
      );
    }

    const now = new Date();
    const updated = await db.user.update({
      where: { id: me.id },
      data: {
        // Syarat & Ketentuan Penggunaan Aplikasi
        appTermsAt: now,
        appTermsVersion: APP_TERMS_VERSION,
        // Kebijakan Penggunaan Data
        dataConsentAt: now,
        dataConsentVersion: DATA_POLICY_VERSION,
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        points: true,
        dataConsentAt: true,
        dataConsentVersion: true,
        appTermsAt: true,
        appTermsVersion: true,
      },
    });

    return NextResponse.json({
      user: {
        ...updated,
        dataConsentAt: updated.dataConsentAt ? updated.dataConsentAt.toISOString() : null,
        appTermsAt: updated.appTermsAt ? updated.appTermsAt.toISOString() : null,
      },
    });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
