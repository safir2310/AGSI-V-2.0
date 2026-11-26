/**
 * get_owner_contact.mjs — ambil data kontak registran dari database aplikasi
 * (data ASLI pemilik, bukan data karangan):
 *  1. Cari user role OWNER / ADMIN (nama, email, phone).
 *  2. Ambil alamat unik dari PESANAN milik user tersebut sendiri (userId cocok)
 *     — alamat kirim yang pernah dipakai pemilik.
 * Coba keduanya scripts/.dburl-neon dan .dburl-prisma-blue; pakai DB yang
 * punya user OWNER. Prisma butuh DATABASE_URL env — di-set dari file.
 * Data pribadi TIDAK dicetak utuh (telepon disamarkan).
 */
import { readFileSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const URLS = [
  ["neon", readFileSync("/home/z/my-project/scripts/.dburl-neon", "utf8").trim()],
  ["prisma-blue", readFileSync("/home/z/my-project/scripts/.dburl-prisma-blue", "utf8").trim()],
];

let found = null;
for (const [label, url] of URLS) {
  try {
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    const users = await prisma.user.findMany({
      where: { role: { in: ["OWNER", "ADMIN"] } },
      select: { id: true, name: true, email: true, phone: true, role: true },
    });
    console.log(`DB ${label}: ${users.length} user OWNER/ADMIN`);
    if (users.length) {
      const ids = users.map((u) => u.id);
      const orders = await prisma.order.findMany({
        where: { userId: { in: ids }, address: { not: null } },
        select: { address: true, phone: true, userId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      });
      const uniq = [...new Map(orders.map((o) => [o.address, o])).values()];
      found = { label, users, addresses: uniq.map((o) => o.address), orderPhones: uniq.map((o) => o.phone).filter(Boolean) };
      console.log(`   alamat unik dari pesanan pemilik: ${found.addresses.length}`);
      await prisma.$disconnect();
      break;
    }
    await prisma.$disconnect();
  } catch (e) {
    console.log(`DB ${label}: gagal — ${String(e.message).slice(0, 120)}`);
  }
}

if (!found) { console.log("TIDAK ADA user OWNER di kedua DB — berhenti."); process.exit(1); }

const { users, addresses, orderPhones } = found;
const maskPhone = (p) => (p ? p.slice(0, 4) + "…" + p.slice(-2) : "-");
for (const u of users) console.log(`- [${u.role}] ${u.name} | ${u.email} | telp ${maskPhone(u.phone)}`);
console.log("Alamat pesanan pemilik (bisa dipakai sbg registran):");
for (const a of addresses.slice(0, 5)) console.log("  •", a.replace(/\n/g, " | ").slice(0, 160));
console.log("Telp dari pesanan:", orderPhones.map(maskPhone).join(", ") || "-");

// simpan hasil terstruktur untuk skrip beli (file internal, bukan deliverable)
writeFileSyncSafe("/home/z/my-project/scripts/.owner-contact.json", JSON.stringify({ users, addresses, orderPhones }, null, 2));
console.log("\nKontak tersimpan di scripts/.owner-contact.json (internal).");

function writeFileSyncSafe(path, data) { try { writeFileSync(path, data); } catch (e) { console.log("gagal simpan:", e.message); } }
