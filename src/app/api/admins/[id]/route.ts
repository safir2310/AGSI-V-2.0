import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, deleteUserSessions, hashPassword, isAdminRole } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/**
 * PUT    /api/admins/[id] — perbarui akun admin/owner { name?, phone?, password?, role? }.
 * DELETE /api/admins/[id] — hapus akun admin/owner (pesanan lama tetap aman, userId jadi null).
 *
 * Aturan akses ("Kelola Admin" di Profil):
 *  - Admin biasa tidak dapat mengelola akun Owner — hanya Owner.
 *  - Tidak bisa mengubah akses atau menghapus akun sendiri.
 *  - Akses (role) hanya boleh diubah oleh Owner; penggantian password/akses
 *    memaksa akun tersebut masuk ulang di semua perangkat.
 *  - Minimal harus tersisa satu akun admin/owner.
 */
const PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  createdAt: true,
} as const;

async function guard() {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) return null;
  return user;
}

export async function PUT(req: NextRequest, { params }: Params) {
  const me = await guard();
  if (!me) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const { id } = await params;

  try {
    const target = await db.user.findUnique({ where: { id }, select: { role: true } });
    if (!target || !isAdminRole(target.role)) {
      return NextResponse.json({ error: "Akun admin tidak ditemukan." }, { status: 404 });
    }
    if (target.role === "OWNER" && me.role !== "OWNER") {
      return NextResponse.json(
        { error: "Hanya Owner yang dapat mengelola akun Owner." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const name = body?.name != null ? String(body.name).trim() : undefined;
    const phone = body?.phone != null ? String(body.phone).trim() : undefined;
    const password = body?.password ? String(body.password) : "";
    const role = body?.role != null ? String(body.role).toUpperCase() : undefined;

    if (name !== undefined && !name) {
      return NextResponse.json({ error: "Nama tidak boleh kosong." }, { status: 400 });
    }
    if (phone !== undefined && phone && !/^[0-9+()\-\s]{6,20}$/.test(phone)) {
      return NextResponse.json({ error: "Nomor HP tidak valid." }, { status: 400 });
    }
    if (password && password.length < 6) {
      return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });
    }
    if (role !== undefined && role !== "ADMIN" && role !== "OWNER") {
      return NextResponse.json(
        { error: "Akses tidak valid — pilih Admin atau Owner." },
        { status: 400 }
      );
    }

    let roleChanged = false;
    if (role !== undefined && role !== target.role) {
      if (id === me.id) {
        return NextResponse.json(
          { error: "Tidak bisa mengubah akses akun sendiri." },
          { status: 400 }
        );
      }
      if (me.role !== "OWNER") {
        return NextResponse.json(
          { error: "Hanya Owner yang dapat mengubah akses." },
          { status: 403 }
        );
      }
      roleChanged = true;
    }

    const updated = await db.user.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(phone !== undefined ? { phone: phone || null } : {}),
        ...(password ? { passwordHash: hashPassword(password) } : {}),
        ...(roleChanged ? { role } : {}),
      },
      select: PUBLIC_SELECT,
    });

    // Password/akses berganti → paksa keluar dari semua perangkat yang sedang masuk
    if (password || roleChanged) {
      await deleteUserSessions(id);
    }

    return NextResponse.json({ admin: updated });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const me = await guard();
  if (!me) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const { id } = await params;

  const target = await db.user.findUnique({ where: { id }, select: { role: true, name: true } });
  if (!target || !isAdminRole(target.role)) {
    return NextResponse.json({ error: "Akun admin tidak ditemukan." }, { status: 404 });
  }
  if (id === me.id) {
    return NextResponse.json(
      { error: "Tidak bisa menghapus akun sendiri." },
      { status: 400 }
    );
  }
  if (target.role === "OWNER" && me.role !== "OWNER") {
    return NextResponse.json(
      { error: "Hanya Owner yang dapat menghapus akun Owner." },
      { status: 403 }
    );
  }

  // Selalu sisakan minimal satu akun admin/owner (perlindungan ganda —
  // larangan hapus akun sendiri di atas sebenarnya sudah menutup kasus ini).
  const total = await db.user.count({ where: { role: { in: ["ADMIN", "OWNER"] } } });
  if (total <= 1) {
    return NextResponse.json(
      { error: "Minimal harus tersisa satu akun admin." },
      { status: 400 }
    );
  }

  // Sesi ikut terhapus (Cascade); pesanan lama hanya kehilangan tautan userId (SetNull)
  await db.user.delete({ where: { id } });
  return NextResponse.json({ ok: true, name: target.name });
}
