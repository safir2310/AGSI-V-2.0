/**
 * set-motion-beranda.mjs — aktifkan ANIMASI TEKS BERANDA (5 teknik: staggered
 * reveal + slide-in + fade-up + pulse lembut + gradient shimmer = efek
 * "showcase") pada konfigurasi Motion Studio yang PUBLISHED.
 *
 *   - heroTitle     → showcase  (loop: denyut lembut + kilauan huruf)
 *   - sectionTitles → staggerReveal (per kata, bergantian)
 * Versi dokumen dinaikkan + entri riwayat ditambahkan (pola publish studio).
 *
 * DATABASE_URL menentukan DB target (lokal sqlite uji / prod postgres).
 * Jalankan: node scripts/dev/set-motion-beranda.mjs
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const db = new PrismaClient({ log: ["error"] });
const row = await db.storeSetting.findUnique({ where: { id: "main" }, select: { motion: true } });
let doc = row?.motion;
if (typeof doc === "string") {
  try {
    doc = JSON.parse(doc);
  } catch {
    doc = null;
  }
}
doc = doc && typeof doc === "object" ? doc : {};

const now = new Date().toISOString();
const targets = { ...(doc.targets ?? {}) };
targets.heroTitle = {
  ...(typeof targets.heroTitle === "object" ? targets.heroTitle : {}),
  enabled: true,
  effect: "showcase",
  duration: 0.7,
  delay: 0.05,
  easing: "easeInOut",
  intensity: 110,
  stagger: 110,
  loop: true,
};
targets.sectionTitles = {
  ...(typeof targets.sectionTitles === "object" ? targets.sectionTitles : {}),
  enabled: true,
  effect: "staggerReveal",
  duration: 0.55,
  delay: 0,
  easing: "easeOut",
  intensity: 100,
  stagger: 80,
  loop: false,
};

const version = (Number(doc.version) || 1) + 1;
const history = Array.isArray(doc.history) ? doc.history : [];
const config = { global: doc.global ?? {}, targets };
history.unshift({
  version,
  at: now,
  by: "AGSI Agent",
  action: "publish",
  summary: "Teks Beranda: showcase 5-in-1 (stagger+slide+fadeUp+pulse+shimmer) & judul section staggerReveal",
  config,
});

await db.storeSetting.upsert({
  where: { id: "main" },
  update: {
    motion: {
      ...doc,
      version,
      updatedAt: now,
      updatedBy: "AGSI Agent",
      targets,
      history: history.slice(0, 15),
    },
  },
  create: {
    id: "main",
    motion: {
      ...doc,
      version,
      updatedAt: now,
      updatedBy: "AGSI Agent",
      targets,
      history: history.slice(0, 15),
    },
  },
});
console.log(`motion diperbarui → v${version}: heroTitle=showcase, sectionTitles=staggerReveal`);
await db.$disconnect();
