import { NextRequest, NextResponse } from "next/server";
import { validatePassword } from "@/lib/password-policy";
import { db } from "@/lib/db";
import { getCurrentUser, hashPassword, isAdminRole } from "@/lib/auth";

/**
 * GET /api/cashiers — daftar akun kasir (khusus Admin/Owner).
 * POST /api/cashiers — tambah akun kasir baru { name, email, phone?, password }.
 */
async function guard() {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) return null;
  return user;
}

export async function GET() {
  if (!(await guard())) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const cashiers = await db.user.findMany({
    where: { role: "CASHIER" },
    select: { id: true, name: true, email: true, phone: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ cashiers });
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

    const cashier = await db.user.create({
      data: {
        name,
        email,
        passwordHash: hashPassword(password),
        phone: phone || null,
        role: "CASHIER",
      },
      select: { id: true, name: true, email: true, phone: true, createdAt: true },
    });

    return NextResponse.json({ cashier }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
