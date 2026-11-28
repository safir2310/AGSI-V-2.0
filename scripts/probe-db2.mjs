/** probe-db2.mjs — cari DB produksi lewat userId push token owner & isi User */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const CANDIDATES = [".dburl-neon", ".dburl-prisma-blue"].map(
  (f) => readFileSync(`/home/z/my-project/scripts/${f}`, "utf8").trim()
);
const UID = "cmw17kimi0000qs4svr4lj6wd";

for (const url of CANDIDATES) {
  const host = new URL(url).hostname;
  process.env.DATABASE_URL = url;
  const c = new PrismaClient();
  try {
    const n = await c.user.count();
    const u = await c.user.findUnique({ where: { id: UID }, select: { email: true, role: true, name: true } });
    const mails = await c.user.findMany({ select: { email: true, role: true }, take: 8, orderBy: { createdAt: "asc" } });
    console.log(`host=${host} users=${n} uid-target=${JSON.stringify(u)}`);
    console.log(`  contoh user: ${mails.map((m) => `${m.email}(${m.role})`).join(", ")}`);
  } catch (e) {
    console.log(`host=${host} GAGAL: ${e.message?.slice(0, 80)}`);
  } finally {
    await c.$disconnect().catch(() => {});
  }
}
