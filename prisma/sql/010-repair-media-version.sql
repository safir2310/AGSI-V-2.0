-- 010: perbaiki baris media lama yang datanya ada tapi kolom VERSI masih NULL.
--
-- Latar belakang: build lama menyimpan bytes gambar/video TANPA menulis
-- kolom mime & timestamp versi bersamaan. Lapisan baca kini menganggap media
-- ada cukup dari keberadaan DATA (mime ditebak dari magic bytes di
-- src/lib/serve-image.ts), TAPI versi yang NULL membuat URL cache-buster
-- memakai konstanta "1" — naikkan ke NOW() agar klien mengambil gambar baru
-- dan popup banner tampil lagi (versi dianggap berubah).
-- Idempotent: hanya menyentuh baris ber-data dengan versi NULL.

UPDATE "StoreSetting" SET "bannerUpdatedAt" = NOW()
  WHERE "bannerImageData" IS NOT NULL AND "bannerUpdatedAt" IS NULL;

UPDATE "StoreSetting" SET "menuHeroUpdatedAt" = NOW()
  WHERE "menuHeroImageData" IS NOT NULL AND "menuHeroUpdatedAt" IS NULL;

UPDATE "StoreSetting" SET "menuPromoBannersUpdatedAt" = NOW()
  WHERE ("menuPromoBanner1ImageData" IS NOT NULL OR "menuPromoBanner2ImageData" IS NOT NULL)
    AND "menuPromoBannersUpdatedAt" IS NULL;

UPDATE "StoreSetting" SET "videoPromoUpdatedAt" = NOW()
  WHERE ("videoPromoSlot1Data" IS NOT NULL OR "videoPromoSlot2Data" IS NOT NULL OR "videoPromoSlot3Data" IS NOT NULL)
    AND "videoPromoUpdatedAt" IS NULL;
