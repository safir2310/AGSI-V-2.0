// e2e-verify.mjs — BUKTI persistensi: baca baris StoreSetting LANGSUNG dari
// database (tanpa lewat API) dan cocokkan dengan nilai yang dikirim E2E.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
// JPEG 1x1 yang dikirim e2e-requests.py (HARUS identik)
const IMG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQN" +
  "DAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDIzNP/AABEIAAEAAQMBIgAC" +
  "EQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQEC" +
  "AwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZH" +
  "SElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4" +
  "ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAAwDAQACEQMRAD8A9/oooooA" +
  "//9k=";
const row = await db.storeSetting.findUnique({ where: { id: "main" } });
if (!row) {
  console.error("FAIL: baris StoreSetting id=main TIDAK ADA di database");
  process.exit(1);
}

const IMG_PREFIX = "data:image/jpeg;base64,";
// Server menyimpan BASE64 TELANJANG (tanpa awalan data URL) + mime di kolom
// terpisah — cocokkan kecocokan PERSIS dengan base64 yang dikirim.
const IMG_RAW = IMG.split(",")[1];
let slides = [];
try {
  slides = JSON.parse(JSON.stringify(row.videoPromoSlides ?? []));
} catch {}
let banners = [];
try {
  banners = JSON.parse(JSON.stringify(row.menuPromoBanners ?? []));
} catch {}

const checks = [
  ["bannerEnabled", row.bannerEnabled === true],
  ["bannerTitle", row.bannerTitle === "Promo Kopi E2E"],
  ["bannerText", row.bannerText === "Diskon 20%"],
  ["bannerImageData tersimpan (base64 persis)", row.bannerImageData === IMG_RAW && row.bannerImageData.length > 400],
  ["bannerImageMime", row.bannerImageMime === "image/jpeg"],
  ["bannerUpdatedAt (versi naik)", !!row.bannerUpdatedAt],
  ["promoStripEnabled", row.promoStripEnabled === true],
  ["promoStripBadge", row.promoStripBadge === "E2E"],
  ["promoStripTitle", row.promoStripTitle === "Promo Hari Ini E2E"],
  ["promoStripText", row.promoStripText === "Berlaku hari ini"],
  ["menuHeroBadge", row.menuHeroBadge === "Baru"],
  ["menuHeroTitle", row.menuHeroTitle === "Hero E2E"],
  ["menuHeroText", row.menuHeroText === "Coba sekarang"],
  ["menuHeroImageData tersimpan (base64 persis)", row.menuHeroImageData === IMG_RAW],
  ["menuHeroUpdatedAt", !!row.menuHeroUpdatedAt],
  ["menuPromoVouchersEnabled", row.menuPromoVouchersEnabled === true],
  ["menuPromoVouchersMax", row.menuPromoVouchersMax === 3],
  ["menuPromoBanners[0] konten", banners[0]?.badge === "P1" && banners[0]?.title === "Banner Satu" && banners[0]?.theme === "violet"],
  ["menuPromoBanners[1] konten", banners[1]?.badge === "P2" && banners[1]?.title === "Banner Dua" && banners[1]?.theme === "emerald"],
  ["menuPromoBanner1ImageData tersimpan (persis)", row.menuPromoBanner1ImageData === IMG_RAW],
  ["menuPromoBanner2ImageData tersimpan (persis)", row.menuPromoBanner2ImageData === IMG_RAW],
  ["menuPromoBannersUpdatedAt", !!row.menuPromoBannersUpdatedAt],
  ["videoPromoEnabled", row.videoPromoEnabled === true],
  ["videoPromoSlides ada 3", Array.isArray(slides) && slides.length === 3],
  ["videoPromoSlides[0]", slides[0]?.slot === 1 && slides[0]?.enabled === true && slides[0]?.title === "Video Satu" && slides[0]?.linkType === "none"],
  ["videoPromoSlides[1] nonaktif + linkType promo", slides[1]?.slot === 2 && slides[1]?.enabled === false && slides[1]?.linkType === "promo"],
  ["videoPromoSlides[2]", slides[2]?.slot === 3 && slides[2]?.title === "Video Tiga"],
  ["videoPromoUpdatedAt", !!row.videoPromoUpdatedAt],
];

let fail = 0;
for (const [name, okk] of checks) {
  console.log(`${okk ? "OK  " : "FAIL"} ${name}`);
  if (!okk) fail++;
}
console.log(`\nBaris DB id=main | panjang bannerImageData: ${(row.bannerImageData ?? "").length} B`);
await db.$disconnect();
if (fail) {
  console.error(`FAIL: ${fail} pengecekan tidak lolos`);
  process.exit(1);
}
console.log("E2E DB VERIFY PASS ✓ — data benar-benar tersimpan di database");
