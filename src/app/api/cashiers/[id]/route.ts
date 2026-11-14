import { NextRequest, NextResponse } from "next/server";
import { validatePassword } from "@/lib/password-policy";
import { db } from "@/lib/db";
import { getCurrentUser, deleteUserSessions, hashPassword, isAdminRole } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/**
 * PUT /api/cashiers/[id] — perbarui akun kasir { name?, phone?, password? }.
 * Password opsional (reset password); mengganti password memaksa kasir masuk ulang.
 * DELETE /api/cashiers/[id] — hapus akun kasir (pesanan lama tetap aman, userId jadi null).
 */
async function guard() {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) return null;
  return user;
}

export async function PUT(req: NextRequest, { params }: Params) {
  if (!(await guard())) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const { id } = await params;

  try {
    const target = await db.user.findUnique({ where: { id }, select: { role: true } });
    if (!target || target.role !== "CASHIER") {
      return NextResponse.json({ error: "Akun kasir tidak ditemukan." }, { status: 404 });
    }

    const body = await req.json();
    const name = body?.name != null ? String(body.name).trim() : undefined;
    const phone = body?.phone != null ? String(body.phone).trim() : undefined;
    const password = body?.password ? String(body.password) : "";

    if (name !== undefined && !name) {
      return NextResponse.json({ error: "Nama tidak boleh kosong." }, { status: 400 });
    }
    if (phone !== undefined && phone && !/^[0-9+()\-\s]{6,20}$/.test(phone)) {
      return NextResponse.json({ error: "Nomor HP tidak valid." }, { status: 400 });
    }
    if (password) {
      const pwCheck = validatePassword(password);
      if (!pwCheck.ok) {
        return NextResponse.json({ error: pwCheck.error }, { status: 400 });
      }
    }

    const updated = await db.user.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(phone !== undefined ? { phone: phone || null } : {}),
        ...(password ? { passwordHash: hashPassword(password) } : {}),
      },
      select: { id: true, name: true, email: true, phone: true, createdAt: true },
    });

    // Reset password → paksa keluar dari semua perangkat yang sedang masuk
    if (password) {
      await deleteUserSessions(id);
    }

    return NextResponse.json({ cashier: updated });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await guard())) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const { id } = await params;

  const target = await db.user.findUnique({ where: { id }, select: { role: true, name: true } });
  if (!target || target.role !== "CASHIER") {
    return NextResponse.json({ error: "Akun kasir tidak ditemukan." }, { status: 404 });
  }

  // Sesi ikut terhapus (Cascade); pesanan lama hanya kehilangan tautan userId (SetNull)
  await db.user.delete({ where: { id } });
  return NextResponse.json({ ok: true, name: target.name });
}
