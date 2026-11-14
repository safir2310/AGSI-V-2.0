import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, hashPassword, isAdminRole } from "@/lib/auth";
import { validatePassword } from "@/lib/password-policy";

/**
 * GET /api/couriers — daftar akun kurir (khusus Admin/Owner).
 * POST /api/couriers — tambah akun kurir baru { name, email, phone?, password }.
 *
 * Kurir masuk dengan email & password seperti kasir — tetapi diarahkan ke
 * BERANDA KURIR (bukan POS): daftar pesanan antar yang ditugaskan kepadanya,
 * lengkap alamat akurat + pin GPS rumah pelanggan.
 */
async function guard() {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) return null;
  return user;
}

const COURIER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  createdAt: true,
} as const;

export async function GET() {
  if (!(await guard())) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const couriers = await db.user.findMany({
    where: { role: "COURIER" },
    select: COURIER_SELECT,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ couriers });
}

export async function POST(req: NextRequest) {
  if (!(await guard())) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  try {
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").toLowerCase().trim();
    const phone = String(body?.phone ?? "").trim();
    const password = body?.password ? String(body.password) : "";

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Nama, email, dan password wajib diisi." },
        { status: 400 }
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Format email tidak valid." }, { status: 400 });
    }
    const pwCheck = validatePassword(password, { email });
    if (!pwCheck.ok) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email sudah dipakai akun lain." }, { status: 409 });
    }

    const courier = await db.user.create({
      data: {
        name,
        email,
        passwordHash: hashPassword(password),
        phone: phone || null,
        role: "COURIER",
      },
      select: COURIER_SELECT,
    });

    return NextResponse.json({ courier }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
