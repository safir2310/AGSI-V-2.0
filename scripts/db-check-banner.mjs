// Pemeriksaan DB produksi — BACA SAJA (tanpa tulis apa pun).
// Membuktikan apakah gambar/video banner yang diupload admin benar-benar
// tersimpan di tabel StoreSetting, meskipun build lama tidak menyajikannya.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const kb = (s) => (s ? `${Math.round((s.length * 3) / 4 / 1024)} KB` : 'KOSONG');

function ringkasJson(v) {
  if (!v) return 'KOSONG';
  try {
    const arr = Array.isArray(v) ? v : [v];
    return JSON.stringify(arr).slice(0, 300);
  } catch {
    return '(tidak valid)';
  }
}

try {
  const row = await prisma.storeSetting.findFirst({
    select: {
      bannerEnabled: true,
      bannerTitle: true,
      bannerImageData: true,
      bannerImageMime: true,
      bannerUpdatedAt: true,
      promoStripTitle: true,
      menuHeroEnabled: true,
      menuHeroImageData: true,
      menuHeroImageMime: true,
      menuHeroUpdatedAt: true,
      menuPromoVouchersEnabled: true,
      menuPromoBanners: true,
      menuPromoBannersUpdatedAt: true,
      menuPromoBanner1ImageData: true,
      menuPromoBanner1ImageMime: true,
      menuPromoBanner2ImageData: true,
      menuPromoBanner2ImageMime: true,
      videoPromoEnabled: true,
      videoPromoSlides: true,
      videoPromoUpdatedAt: true,
      videoPromoSlot1Data: true,
      videoPromoSlot1Mime: true,
      videoPromoSlot2Data: true,
      videoPromoSlot2Mime: true,
      videoPromoSlot3Data: true,
      videoPromoSlot3Mime: true,
      updatedAt: true,
    },
  });

  if (!row) {
    console.log('BARIS StoreSetting: TIDAK ADA (belum pernah dibuat)');
  } else {
    console.log('=== ISI BARIS StoreSetting (produksi, baca-saja) ===');
    console.log('updatedAt keseluruhan :', row.updatedAt?.toISOString?.() ?? row.updatedAt);
    console.log('');
    console.log('--- Banner Popup ---');
    console.log('bannerEnabled   :', row.bannerEnabled);
    console.log('bannerTitle     :', row.bannerTitle ?? '(kosong)');
    console.log('bannerImage     :', kb(row.bannerImageData), '| mime:', row.bannerImageMime ?? '(kosong)');
    console.log('bannerUpdatedAt :', row.bannerUpdatedAt?.toISOString?.() ?? '(kosong)');
    console.log('');
    console.log('--- Hero Menu ---');
    console.log('menuHeroEnabled :', row.menuHeroEnabled);
    console.log('menuHeroImage   :', kb(row.menuHeroImageData), '| mime:', row.menuHeroImageMime ?? '(kosong)');
    console.log('menuHeroUpdatedAt:', row.menuHeroUpdatedAt?.toISOString?.() ?? '(kosong)');
    console.log('');
    console.log('--- Banner Promo Menu (2 slot) ---');
    console.log('vouchersEnabled :', row.menuPromoVouchersEnabled);
    console.log('slot1 image     :', kb(row.menuPromoBanner1ImageData), '| mime:', row.menuPromoBanner1ImageMime ?? '(kosong)');
    console.log('slot2 image     :', kb(row.menuPromoBanner2ImageData), '| mime:', row.menuPromoBanner2ImageMime ?? '(kosong)');
    console.log('konfig banner   :', ringkasJson(row.menuPromoBanners));
    console.log('bannersUpdatedAt:', row.menuPromoBannersUpdatedAt?.toISOString?.() ?? '(kosong)');
    console.log('');
    console.log('--- Video Promo (3 slot) ---');
    console.log('videoPromoEnabled:', row.videoPromoEnabled);
    console.log('slot1 video     :', kb(row.videoPromoSlot1Data), '| mime:', row.videoPromoSlot1Mime ?? '(kosong)');
    console.log('slot2 video     :', kb(row.videoPromoSlot2Data), '| mime:', row.videoPromoSlot2Mime ?? '(kosong)');
    console.log('slot3 video     :', kb(row.videoPromoSlot3Data), '| mime:', row.videoPromoSlot3Mime ?? '(kosong)');
    console.log('konfig slides   :', ringkasJson(row.videoPromoSlides));
    console.log('videoUpdatedAt  :', row.videoPromoUpdatedAt?.toISOString?.() ?? '(kosong)');
    console.log('');
    console.log('--- Promo Strip ---');
    console.log('promoStripTitle :', row.promoStripTitle);
  }
} catch (err) {
  console.error('GAGAL KONEKSI / QUERY:', err.message?.slice(0, 200));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
