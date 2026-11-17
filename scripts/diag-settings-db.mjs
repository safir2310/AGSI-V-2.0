/**
 * Diagnosa akar "banner & promo tersimpan tidak muncul" — bukti empiris ke DB
 * produksi (DATABASE_URL dari .env, tidak dicetak):
 *
 *   1. POLA LAMA : Promise.all dari 6 `upsert` paralel ke baris yang sama
 *                  (persis GET /api/settings sebelum perbaikan).
 *   2. POLA BARU : 1 `findUnique` read-only (persis getStoreSettingsSnapshot).
 *   3. Status data banner/promo di produksi (boolean + panjang bytes, tanpa isi).
 *
 * Jalankan: node scripts/diag-settings-db.mjs
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

// Muat .env manual (tanpa mencetak isinya).
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const db = new PrismaClient({ log: ["error"] });

async function timed(label, fn) {
  const t0 = Date.now();
  let err = null;
  let res = null;
  try {
    res = await fn();
  } catch (e) {
    err = e?.message ?? String(e);
  }
  console.log(`${label}: ${Date.now() - t0} ms${err ? `  ERROR: ${err}` : "  OK"}`);
  return { res, err };
}

const upsertNoop = () =>
  db.storeSetting.upsert({ where: { id: "main" }, update: {}, create: { id: "main" } });

console.log("=== 1. POLA LAMA: 6 upsert paralel (dipakai GET /api/settings dulu) ===");
for (let round = 1; round <= 2; round++) {
  const { err } = await timed(`ronde ${round}`, () =>
    Promise.all([
      upsertNoop(),
      upsertNoop(),
      upsertNoop(),
      upsertNoop(),
      upsertNoop(),
      upsertNoop(),
    ])
  );
  if (err) {
    // Coba serial utk membandingkan
    await timed("  (referensi) 1 upsert tunggal", upsertNoop);
  }
}

console.log("=== 2. POLA BARU: 1 findUnique read-only ===");
for (let round = 1; round <= 3; round++) {
  await timed(`ronde ${round}`, () =>
    db.storeSetting.findUnique({
      where: { id: "main" },
      select: {
        bannerEnabled: true,
        bannerImageData: true,
        menuHeroImageData: true,
        menuPromoBanner1ImageData: true,
        menuPromoBanner2ImageData: true,
        videoPromoEnabled: true,
        videoPromoSlot1Data: true,
      },
    })
  );
}

console.log("=== 3. STATUS DATA PRODUKSI (boolean & panjang, tanpa isi) ===");
const row = await db.storeSetting.findUnique({ where: { id: "main" } });
if (!row) {
  console.log("Baris id=main TIDAK ADA");
} else {
  const len = (v) => (v == null ? 0 : v.length);
  console.log("bannerEnabled:", row.bannerEnabled, "| bannerImageData:", len(row.bannerImageData), "char | mime:", row.bannerImageMime ?? "-", "| updatedAt:", row.bannerUpdatedAt?.toISOString() ?? "-");
  console.log("menuHeroImageData:", len(row.menuHeroImageData), "char | menuHeroUpdatedAt:", row.menuHeroUpdatedAt?.toISOString() ?? "-");
  console.log("menuPromo1ImageData:", len(row.menuPromoBanner1ImageData), "char | menuPromo2ImageData:", len(row.menuPromoBanner2ImageData), "char");
  console.log("videoPromoEnabled:", row.videoPromoEnabled, "| slot1Data:", len(row.videoPromoSlot1Data), "char | slot2Data:", len(row.videoPromoSlot2Data), "char | slot3Data:", len(row.videoPromoSlot3Data), "char");
  const b64 = row.bannerImageData ?? "";
  const bytes = b64 ? Buffer.from(b64, "base64") : Buffer.alloc(0);
  console.log(
    "banner image magic:",
    bytes.subarray(0, 4).toString("hex"),
    "(ffd8=JPEG, 89504e47=PNG)",
    "≈",
    Math.round(bytes.byteLength / 1024),
    "KB"
  );
}

await db.$disconnect();
