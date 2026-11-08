import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isEmailConfigured } from "@/lib/email";
import { isFcmConfigured } from "@/lib/fcm";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — status kesiapan layanan server (BOOLEAN saja, tanpa nilai rahasia).
 *
 * Dipakai untuk memverifikasi Environment Variables di server produksi (Vercel)
 * tanpa harus membuka log: bila `database:false` berarti DATABASE_URL belum diisi,
 * `emailOtp:false` berarti RESEND_API_KEY belum ada, dst. Aman dipublikasi.
 *
 * Contoh respons:
 * { "ready": true, "database": true, "emailOtp": true, "pushServer": true, "time": "…" }
 */
export async function GET() {
  let database = false;
  try {
    await db.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }

  const emailOtp = isEmailConfigured();
  const pushServer = isFcmConfigured();

  return NextResponse.json(
    {
      ready: database && emailOtp && pushServer,
      database,
      emailOtp,
      pushServer,
      time: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } }
  );
}
