// e2e-image-display-check.mjs — REGRESI tampilnya gambar:
// 1) RUSAKKAN baris persis seperti sisa build lama di produksi:
//    kolom mime & timestamp versi di-NUL-kan, DATA gambar dibiarkan ada.
// 2) GET /api/settings harus tetap melaporkan hasImage=true (bug lama:
//    hasImage=false → gambar tak pernah tampil).
// 3) Endpoint gambar harus tetap menyajikan bytes JPEG valid + Content-Type.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const BASE = process.argv[2] || "http://localhost:3123";

async function jget(path) {
  const r = await fetch(BASE + path);
  return { status: r.status, ct: r.headers.get("content-type"), buf: Buffer.from(await r.arrayBuffer()) };
}

(async () => {
  // 1) simulasi baris lama: mime + versi NULL, data tetap ada
  await db.storeSetting.upsert({
    where: { id: "main" },
    update: {
      bannerImageMime: null,
      bannerUpdatedAt: null,
      menuHeroImageMime: null,
      menuHeroUpdatedAt: null,
      menuPromoBanner1ImageMime: null,
      menuPromoBanner2ImageMime: null,
      menuPromoBannersUpdatedAt: null,
      videoPromoSlot1Mime: null,
      videoPromoUpdatedAt: null,
    },
    create: { id: "main" },
  });
  console.log("baris dirusak (mime+versi NULL, data tetap) ✓");

  let fail = 0;
  const check = (name, ok, extra = "") => {
    console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " | " + extra : ""}`);
    if (!ok) fail++;
  };

  // 2) GET /api/settings — hasImage WAJIB true walau mime NULL
  const s = await (await fetch(BASE + "/api/settings")).json();
  const b = s.banner ?? {};
  check("banner.hasImage=true (mime NULL)", b.bannerHasImage === true);
  check("banner.bannerImageUrl terisi", typeof b.bannerImageUrl === "string" && b.bannerImageUrl.startsWith("/api/settings/banner/image"));
  const h = s.menuHero ?? {};
  check("hero.hasImage=true", h.menuHeroHasImage === true);
  check("hero.menuHeroImageUrl terisi", typeof h.menuHeroImageUrl === "string");
  const mps = s.menuPromo?.banners ?? [];
  check("menuPromo[0].hasImage=true", mps[0]?.hasImage === true);
  check("menuPromo[1].hasImage=true", mps[1]?.hasImage === true);

  // 3) endpoint gambar — 200 + image/jpeg + magic FFD8
  for (const [name, path] of [
    ["banner", "/api/settings/banner/image"],
    ["menu-hero", "/api/settings/menu-hero/image"],
    ["menu-promo slot1", "/api/settings/menu-promo/image?slot=1"],
    ["menu-promo slot2", "/api/settings/menu-promo/image?slot=2"],
  ]) {
    try {
      const r = await jget(path);
      check(
        `${name}: 200 + jpeg`,
        r.status === 200 && /image\//.test(r.ct ?? "") && r.buf[0] === 0xff && r.buf[1] === 0xd8,
        `${r.status} CT=${r.ct} ${r.buf.length}B`,
      );
    } catch (e) {
      check(`${name}: 200 + jpeg`, false, String(e).slice(0, 80));
    }
  }

  await db.$disconnect();
  if (fail) {
    console.error(`FAIL: ${fail} pengecekan gagal`);
    process.exit(1);
  }
  console.log("E2E IMAGE DISPLAY PASS ✓ — gambar lama (tanpa mime/versi) kini TAMPIL");
})().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
