/**
 * set-animstyle-emoji-via-vercel.mjs — patch gaya animasi spanduk beranda
 * di DB PRODUKSI ke MODEL BARU "emoji" (🔥⛵️🎃) tanpa perlu .env lokal:
 * DATABASE_URL produksi diambil dari Vercel Env API memakai token di
 * scripts/.vtoken. Nilai URL tidak pernah dicetak. Sambil di situ, .env
 * lokal yang sempat tertimpa URL sqlite DIPULIHKAN ke URL produksi.
 * Jalankan: node scripts/set-animstyle-emoji-via-vercel.mjs
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";

const VT = readFileSync("/home/z/my-project/scripts/.vtoken", "utf8").trim();
const TEAM = "team_gSL83YS5Iip6SdjlzMr9gWvR";
const PRJ = "agsi-v-2-0";

// 1) Ambil env vars proyek → cari id DATABASE_URL produksi
const list = await fetch(
  `https://api.vercel.com/v10/projects/${PRJ}/env?teamId=${TEAM}`,
  { headers: { Authorization: `Bearer ${VT}` } }
).then((r) => r.json());
if (!Array.isArray(list.envs)) throw new Error("Gagal list env Vercel: " + JSON.stringify(list.error ?? {}));

const dbEnv = list.envs.find((e) => e.key === "DATABASE_URL" && (e.target ?? []).includes("production"));
if (!dbEnv) throw new Error("DATABASE_URL produksi tidak ditemukan di Vercel");

// 2) Dekrip nilainya
const one = await fetch(
  `https://api.vercel.com/v9/projects/${PRJ}/env/${dbEnv.id}?teamId=${TEAM}&decrypt=true`,
  { headers: { Authorization: `Bearer ${VT}` } }
).then((r) => r.json());
if (!one.value) throw new Error("Gagal dekrip DATABASE_URL: " + JSON.stringify(one.error ?? {}));
const prodUrl = one.value;
if (!/^postgres(ql)?:\/\//.test(prodUrl)) throw new Error("DATABASE_URL produksi bukan postgres — batal.");

// 3) Patch DB: hanya field animStyle → "emoji", field lain dipertahankan
process.env.DATABASE_URL = prodUrl;
const db = new PrismaClient({ log: ["error"] });
const row = await db.storeSetting.findUnique({ where: { id: "main" }, select: { courierAnim: true } });
const before = row?.courierAnim ?? {};
console.log("SEBELUM:", JSON.stringify({ animStyle: before.animStyle ?? "(kosong)" }));
if (before.animStyle === "emoji") {
  console.log("Sudah 'emoji' — tidak ada perubahan DB.");
} else {
  await db.storeSetting.update({
    where: { id: "main" },
    data: { courierAnim: { ...before, animStyle: "emoji" } },
  });
  console.log("SESUDAH:", JSON.stringify({ animStyle: "emoji" }));
  console.log("Field lain dipertahankan:", Object.keys(before).length, "field.");
}
await db.$disconnect();

// 4) Pulihkan .env lokal (sempat tertimpa URL sqlite oleh sesi uji)
writeFileSync("/home/z/my-project/.env", `DATABASE_URL=${prodUrl}\n`);
console.log(".env lokal dipulihkan ke URL produksi (nilai tak dicetak).");
