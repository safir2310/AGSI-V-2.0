/* Bersihkan jejak pengujian chat: sisakan 1 utas demo budi ↔ admin yang rapi,
 * reset semua hitungan belum-dibaca ke 0.
 *   node scripts/cleanup-chat-demo.cjs        -> wipe + seed demo
 *   node scripts/cleanup-chat-demo.cjs wipe   -> wipe saja (untuk test suite) */
const { PrismaClient } = require("/home/z/my-project/node_modules/.prisma/client");
const db = new PrismaClient();
const WIPE_ONLY = process.argv[2] === "wipe";

async function main() {
  // hapus semua pesan & utas lama (berisi noise pengujian)
  await db.chatMessage.deleteMany({});
  await db.chatThread.deleteMany({});
  console.log("chat dibersihkan");

  if (WIPE_ONLY) return console.log("WIPE SAJA SELESAI");
  // utas demo rapi untuk budi
  const budi = await db.user.findUnique({ where: { email: "budi@example.com" } });
  const admin = await db.user.findUnique({ where: { email: "admin@agsi.test" } });
  if (!budi || !admin) return console.log("user demo tidak ditemukan — selesai");

  const now = Date.now();
  const t = await db.chatThread.create({
    data: { userId: budi.id, lastMessageBody: "Buka kak, jam 10.00–22.00 tiap hari. Antar gratis sampai 5 km ya 🐔", lastSenderRole: "OWNER", lastMessageAt: new Date(now - 24 * 60000) },
  });
  await db.chatMessage.createMany({
    data: [
      {
        threadId: t.id, senderId: budi.id, senderName: budi.name, senderRole: "CUSTOMER",
        body: "Kak, besok buka ga? mau pesan buat diantar ke kantor",
        createdAt: new Date(now - 26 * 60000),
      },
      {
        threadId: t.id, senderId: admin.id, senderName: admin.name, senderRole: "OWNER",
        body: "Buka kak, jam 10.00–22.00 tiap hari. Antar gratis sampai 5 km ya 🐔",
        createdAt: new Date(now - 24 * 60000),
      },
    ],
  });
  console.log("utas demo budi dibuat");

  const v = await db.voucher.findUnique({ where: { code: "PNT-AKDTVC" } });
  if (v) {
    await db.voucherRedemption.deleteMany({ where: { voucherId: v.id } });
    await db.voucher.delete({ where: { id: v.id } });
    console.log("voucher uji PNT-AKDTVC dihapus");
  }
  console.log("SELESAI");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
