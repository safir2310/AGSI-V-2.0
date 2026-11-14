import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, deleteUserSessions, hashPassword, isAdminRole } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/**
 * PUT /api/couriers/[id] — perbarui akun kurir { name?, phone?, password? }.
 * Password opsional (reset password); mengganti password memaksa kurir masuk ulang.
 * DELETE /api/couriers/[id] — hapus akun kurir (pesanan lama tetap aman —
 * kolom courierName di pesanan adalah snapshot, tidak terhapus).
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
    if (!target || target.role !== "COURIER") {
      return NextResponse.json({ error: "Akun kurir tidak ditemukan." }, { status: 404 });
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
    if (password && password.length < 6) {
      return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });
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

    return NextResponse.json({ courier: updated });
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
  if (!target || target.role !== "COURIER") {
    return NextResponse.json({ error: "Akun kurir tidak ditemukan." }, { status: 404 });
  }

  // Lepas tugas pesanan aktif yang masih menunjuk akun ini (kurirName tetap
  // sebagai snapshot) supaya pesanan tidak "terjebak" di akun yang dihapus.
  await db.order.updateMany({
    where: { courierUserId: id, status: { in: ["READY"] }, onTheWayAt: null },
    data: { courierUserId: null },
  });

  // Sesi ikut terhapus (Cascade); pesanan lama hanya kehilangan tautan userId (SetNull)
  await db.user.delete({ where: { id } });
  return NextResponse.json({ ok: true, name: target.name });
}
