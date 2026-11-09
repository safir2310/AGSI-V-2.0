import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, hashPassword, isAdminRole } from "@/lib/auth";

/**
 * GET  /api/admins — daftar akun admin & owner (khusus Admin/Owner).
 * POST /api/admins — tambah akun admin/owner baru { name, email, phone?, password, role }.
 *
 * Aturan akses ("Kelola Admin" di Profil):
 *  - Hanya ADMIN/OWNER yang bisa melihat daftar & menambah akun.
 *  - Hanya OWNER yang boleh membuat akun ber-akses OWNER.
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

export async function GET() {
  if (!(await guard())) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }
  const admins = await db.user.findMany({
    where: { role: { in: ["ADMIN", "OWNER"] } },
    select: PUBLIC_SELECT,
    orderBy: [{ createdAt: "asc" }],
  });
  return NextResponse.json({ admins });
}

export async function POST(req: NextRequest) {
  const me = await guard();
  if (!me) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  try {
    const body = await req.json();
    const name = String(body?.name ?? "").trim();
    const email = String(body?.email ?? "").toLowerCase().trim();
    const phone = String(body?.phone ?? "").trim();
    const password = body?.password ? String(body.password) : "";
    const role = String(body?.role ?? "ADMIN").toUpperCase();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: "Nama, email, dan password wajib diisi." },
        { status: 400 }
      );
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Format email tidak valid." }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });
    }
    if (phone && !/^[0-9+()\-\s]{6,20}$/.test(phone)) {
      return NextResponse.json({ error: "Nomor HP tidak valid." }, { status: 400 });
    }
    if (role !== "ADMIN" && role !== "OWNER") {
      return NextResponse.json(
        { error: "Akses tidak valid — pilih Admin atau Owner." },
        { status: 400 }
      );
    }
    // Escalation guard: admin biasa tidak bisa menciptakan sesama Owner.
    if (role === "OWNER" && me.role !== "OWNER") {
      return NextResponse.json(
        { error: "Hanya Owner yang dapat menambah akun Owner." },
        { status: 403 }
      );
    }

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email sudah dipakai akun lain." }, { status: 409 });
    }

    const admin = await db.user.create({
      data: {
        name,
        email,
        passwordHash: hashPassword(password),
        phone: phone || null,
        role,
      },
      select: PUBLIC_SELECT,
    });

    return NextResponse.json({ admin }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
