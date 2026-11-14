import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { notifyChatMessage } from "@/lib/push";

/**
 * CHAT CS (pelanggan ↔ admin).
 *
 * GET /api/chat
 *   - Pelanggan/kasir: utas chat SENDIRI (pesan asc) + reset unreadCustomer.
 *   - Admin/owner:
 *       ?threadId=x     → buka satu utas (pesan asc) + reset unreadAdmin utas itu.
 *       ?threadUserId=x → cari/buat utas satu pelanggan tertentu (dari kartu
 *                         pesanan admin) — utas baru bila pelanggan belum pernah chat.
 *       tanpa param     → daftar SEMUA utas (urut pesan terbaru) + total belum dibaca.
 *
 * POST /api/chat { body, userId? }
 *   - Pelanggan/kasir: kirim pesan ke utas sendiri (userId diabaikan).
 *   - Admin/owner: wajib userId → balas utas pelanggan tersebut.
 */

const MAX_BODY = 500;
const MAX_MESSAGES = 200;

function serializeMessage(m: {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  body: string;
  createdAt: Date;
}) {
  return {
    id: m.id,
    senderId: m.senderId,
    senderName: m.senderName,
    senderRole: m.senderRole,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
  }

  const threadId = req.nextUrl.searchParams.get("threadId");
  const threadUserId = req.nextUrl.searchParams.get("threadUserId");

  // ===== ADMIN: daftar utas / buka satu utas =====
  if (isAdminRole(user.role)) {
    // Buka langsung utas satu pelanggan (tombol 💬 di kartu pesanan admin).
    // Utas dibuat otomatis bila pelanggan ini belum pernah chat sama sekali.
    if (threadUserId) {
      const target = await db.user.findUnique({ where: { id: threadUserId } });
      if (!target) {
        return NextResponse.json({ error: "Akun pelanggan tidak ditemukan." }, { status: 404 });
      }
      const thread = await db.chatThread.upsert({
        where: { userId: target.id },
        create: { userId: target.id },
        update: {},
      });
      // Petugas sedang membuka utas ini → pesan pelanggan dianggap sudah dibaca
      if (thread.unreadAdmin > 0) {
        await db.chatThread.update({ where: { id: thread.id }, data: { unreadAdmin: 0 } });
      }
      return NextResponse.json({
        thread: {
          id: thread.id,
          userId: thread.userId,
          name: target.name,
          email: target.email,
          phone: target.phone,
          lastMessageAt: thread.lastMessageAt.toISOString(),
          lastMessageBody: thread.lastMessageBody,
          lastSenderRole: thread.lastSenderRole,
          unreadAdmin: 0,
        },
      });
    }

    if (threadId) {
      const thread = await db.chatThread.findUnique({
        where: { id: threadId },
        include: { user: { select: { id: true, name: true, email: true, phone: true } } },
      });
      if (!thread) {
        return NextResponse.json({ error: "Percakapan tidak ditemukan." }, { status: 404 });
      }
      // Petugas sedang membaca utas ini → pesan pelanggan dianggap sudah dibaca
      if (thread.unreadAdmin > 0) {
        await db.chatThread.update({ where: { id: thread.id }, data: { unreadAdmin: 0 } });
      }
      const messages = await db.chatMessage.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: "desc" },
        take: MAX_MESSAGES,
      });
      return NextResponse.json({
        thread: {
          id: thread.id,
          userId: thread.userId,
          name: thread.user.name,
          email: thread.user.email,
          phone: thread.user.phone,
        },
        messages: messages.reverse().map(serializeMessage),
      });
    }

    const threads = await db.chatThread.findMany({
      orderBy: { lastMessageAt: "desc" },
      include: { user: { select: { name: true, email: true, phone: true } } },
      take: 100,
    });
    return NextResponse.json({
      threads: threads.map((t) => ({
        id: t.id,
        userId: t.userId,
        name: t.user.name,
        email: t.user.email,
        phone: t.user.phone,
        lastMessageAt: t.lastMessageAt.toISOString(),
        lastMessageBody: t.lastMessageBody,
        lastSenderRole: t.lastSenderRole,
        unreadAdmin: t.unreadAdmin,
      })),
      unreadTotal: threads.reduce((s, t) => s + t.unreadAdmin, 0),
    });
  }

  // ===== PELANGGAN / KASIR: utas sendiri =====
  const own = await db.chatThread.findUnique({ where: { userId: user.id } });
  if (!own) {
    return NextResponse.json({ messages: [] });
  }
  // Sedang membuka chat → balasan CS dianggap sudah dibaca
  if (own.unreadCustomer > 0) {
    await db.chatThread.update({ where: { id: own.id }, data: { unreadCustomer: 0 } });
  }
  const messages = await db.chatMessage.findMany({
    where: { threadId: own.id },
    orderBy: { createdAt: "desc" },
    take: MAX_MESSAGES,
  });
  return NextResponse.json({ messages: messages.reverse().map(serializeMessage) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Silakan masuk terlebih dahulu." }, { status: 401 });
  }

  try {
    const payload = await req.json();
    const text = String(payload?.body ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "Pesan tidak boleh kosong." }, { status: 400 });
    }
    if (text.length > MAX_BODY) {
      return NextResponse.json(
        { error: `Pesan maksimal ${MAX_BODY} karakter.` },
        { status: 400 }
      );
    }

    // ===== ADMIN membalas utas pelanggan =====
    if (isAdminRole(user.role)) {
      const targetUserId = String(payload?.userId ?? "");
      if (!targetUserId) {
        return NextResponse.json(
          { error: "UserId pelanggan wajib diisi untuk membalas chat." },
          { status: 400 }
        );
      }
      // Buat utas bila pelanggan ini belum pernah chat sama sekali
      const thread = await db.chatThread.upsert({
        where: { userId: targetUserId },
        create: { userId: targetUserId },
        update: {},
      });
      const message = await db.$transaction(async (tx) => {
        const m = await tx.chatMessage.create({
          data: {
            threadId: thread.id,
            senderId: user.id,
            senderName: user.name,
            senderRole: user.role,
            body: text,
          },
        });
        await tx.chatThread.update({
          where: { id: thread.id },
          data: {
            lastMessageAt: m.createdAt,
            lastMessageBody: text,
            lastSenderRole: user.role,
            unreadAdmin: 0, // petugas jelas sudah membaca utas ini
            unreadCustomer: { increment: 1 },
          },
        });
        return m;
      });
      // 🔔 Push ke pelanggan: balasan CS masuk — after() menjamin terkirim
      after(() => notifyChatMessage({
        fromRole: user.role,
        toUserId: targetUserId,
        senderName: user.name,
        body: text,
      }));
      return NextResponse.json({ message: serializeMessage(message) }, { status: 201 });
    }

    // ===== PELANGGAN / KASIR mengirim ke utas sendiri =====
    const message = await db.$transaction(async (tx) => {
      const thread = await tx.chatThread.upsert({
        where: { userId: user.id },
        create: { userId: user.id },
        update: {},
      });
      const m = await tx.chatMessage.create({
        data: {
          threadId: thread.id,
          senderId: user.id,
          senderName: user.name,
          senderRole: user.role,
          body: text,
        },
      });
      await tx.chatThread.update({
        where: { id: thread.id },
        data: {
          lastMessageAt: m.createdAt,
          lastMessageBody: text,
          lastSenderRole: user.role,
          unreadAdmin: { increment: 1 },
          unreadCustomer: 0, // pelanggan aktif menulis → balasan lama dianggap terbaca
        },
      });
      return m;
    });
    // 🔔 Push ke perangkat petugas CS (admin/owner) — real-time via after()
    after(() => notifyChatMessage({ fromRole: user.role, senderName: user.name, body: text }));
    return NextResponse.json({ message: serializeMessage(message) }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
