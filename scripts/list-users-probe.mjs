/**
 * list-users-probe.mjs — data ringkas akun (email, role, phone) dari DB
 * produksi utk: (1) menemukan no. HP staff yang dipakai uji WA,
 * (2) memilih akun pelanggan utk probe error email produksi.
 * Tidak mencetak data sensitif selain email/role/phone ter-mask sebagian.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const mask = (s) => (s && s.length > 6 ? `${s.slice(0, 3)}•••${s.slice(-4)}` : s);

const users = await db.user.findMany({
  select: { email: true, name: true, role: true, phone: true },
  orderBy: { role: "asc" },
});
for (const u of users) {
  console.log(`${u.role}\t${u.email}\t${u.name ?? "-"}\t${u.phone ? mask(u.phone) : "-"}`);
}
console.log(`--- total: ${users.length}`);
await db.$disconnect();
