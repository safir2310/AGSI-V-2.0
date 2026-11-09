import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import {
  MENU_PROMO_BANNER_THEMES,
  getBannerSettings,
  getMenuHeroSettings,
  getMenuPromoSettings,
  getPromoStripSettings,
  getStoreSettings,
  updateBannerSettings,
  updateMenuHeroSettings,
  updateMenuPromoSettings,
  updatePromoStripSettings,
  updateStoreSettings,
  type BannerPatch,
  type MenuHeroPatch,
  type MenuPromoBannerPatch,
  type MenuPromoPatch,
  type PromoStripPatch,
} from "@/lib/store-settings";

/** Susun URL gambar hero menu dengan cache-buster (null bila tak tersedia). */
function menuHeroImageUrl(hasImage: boolean, enabled: boolean, version: string | null) {
  return enabled && hasImage
    ? `/api/settings/menu-hero/image?v=${encodeURIComponent(version ?? "1")}`
    : null;
}

/**
 * GET /api/settings — pengaturan layanan toko (PUBLIK).
 * Dipakai aplikasi pelanggan & POS untuk menyembunyikan opsi yang
 * dinonaktifkan admin (antar pesanan / pembayaran QRIS),
 * plus konten popup banner beranda (tanpa bytes gambar — dimuat
 * terpisah via /api/settings/banner/image agar ringan), konten
 * strip "Promo Hari Ini" di Beranda, dan konten hero banner promo
 * di halaman Menu (gambar terpisah via /api/settings/menu-hero/image),
 * plus setelan carousel promo Menu (menuPromo): saklar slide voucher,
 * jumlah maksimalnya, dan konfigurasi 2 banner promo custom
 * (gambar latar terpisah via /api/settings/menu-promo/image?slot=1|2).
 */
export async function GET() {
  try {
    const [settings, banner, promo, menuHero, menuPromo] = await Promise.all([
      getStoreSettings(),
      getBannerSettings(),
      getPromoStripSettings(),
      getMenuHeroSettings(),
      getMenuPromoSettings(),
    ]);
    return NextResponse.json({
      ...settings,
      banner: {
        ...banner,
        bannerImageUrl:
          banner.bannerEnabled && banner.bannerHasImage
            ? `/api/settings/banner/image?v=${encodeURIComponent(banner.bannerVersion ?? "1")}`
            : null,
      },
      promo,
      menuHero: {
        ...menuHero,
        menuHeroImageUrl: menuHeroImageUrl(
          menuHero.menuHeroHasImage,
          menuHero.menuHeroEnabled,
          menuHero.menuHeroVersion
        ),
      },
      menuPromo: {
        ...menuPromo,
        banners: menuPromo.banners.map((b) => ({
          ...b,
          imageUrl:
            b.enabled && b.hasImage
              ? `/api/settings/menu-promo/image?slot=${b.slot}&v=${encodeURIComponent(menuPromo.version ?? "1")}`
              : null,
        })),
      },
    });
  } catch {
    return NextResponse.json(
      {
        deliveryEnabled: true,
        qrisEnabled: true,
        banner: {
          bannerEnabled: false,
          bannerTitle: null,
          bannerText: null,
          bannerHasImage: false,
          bannerVersion: null,
          bannerImageUrl: null,
        },
        promo: {
          promoStripEnabled: true,
          promoStripBadge: "Promo Hari Ini",
          promoStripTitle: "Paket Komplit mulai Rp 27.000",
          promoStripText: "Geprek + nasi + es teh manis jumbo",
        },
        menuHero: {
          menuHeroEnabled: true,
          menuHeroBadge: "Promo Spesial",
          menuHeroTitle: "Paket Komplit mulai Rp 27.000",
          menuHeroText: "Geprek + nasi + es teh manis jumbo",
          menuHeroHasImage: false,
          menuHeroVersion: null,
          menuHeroImageUrl: null,
        },
        menuPromo: {
          menuPromoVouchersEnabled: true,
          menuPromoVouchersMax: 3,
          banners: [
            { slot: 1, enabled: true, badge: "Promo Spesial", title: "Beli 2 Gratis 1 Es Teh", text: "Berlaku setiap hari kerja di outlet AGSI", emoji: "🥤", theme: "violet", hasImage: false, imageUrl: null },
            { slot: 2, enabled: true, badge: "Menu Baru", title: "Ayam Geprik Sambal Bawang", text: "Pedas nampol, harga hemat mulai Rp 15.000", emoji: "🌶️", theme: "emerald", hasImage: false, imageUrl: null },
          ],
          version: null,
        },
      },
      { status: 200 }
    );
  }
}

/**
 * PUT /api/settings — ubah saklar layanan & konten banner (KHUSUS Admin/Owner).
 * Body saklar : { deliveryEnabled?: boolean, qrisEnabled?: boolean }
 * Body banner : { bannerEnabled?, bannerTitle?, bannerText?, bannerImageData?, bannerImageRemove?, bannerTouch? }
 * Body promo  : { promoStripEnabled?, promoStripBadge?, promoStripTitle?, promoStripText? }
 * Body hero   : { menuHeroEnabled?, menuHeroBadge?, menuHeroTitle?, menuHeroText?, menuHeroImageData?, menuHeroImageRemove?, menuHeroTouch? }
 * Body mPromo : { menuPromoVouchersEnabled?, menuPromoVouchersMax?, menuPromoBanners?: [...] } —
 *               carousel promo Menu: slide voucher + 2 banner promo custom
 *               (menuPromoBanners: [{ slot: 1|2, enabled?, badge?, title?, text?, emoji?, theme?, imageData?, imageRemove? }])
 */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  try {
    const body = await req.json();
    const patch: { deliveryEnabled?: boolean; qrisEnabled?: boolean } = {};

    if ("deliveryEnabled" in body) {
      if (typeof body.deliveryEnabled !== "boolean") {
        return NextResponse.json(
          { error: "deliveryEnabled harus boolean." },
          { status: 400 }
        );
      }
      patch.deliveryEnabled = body.deliveryEnabled;
    }
    if ("qrisEnabled" in body) {
      if (typeof body.qrisEnabled !== "boolean") {
        return NextResponse.json(
          { error: "qrisEnabled harus boolean." },
          { status: 400 }
        );
      }
      patch.qrisEnabled = body.qrisEnabled;
    }

    if (Object.keys(patch).length > 0) {
      await updateStoreSettings(patch);
    }

    // ===== Popup banner =====
    let bannerResult: Awaited<ReturnType<typeof updateBannerSettings>> | null = null;
    const bannerKeys = [
      "bannerEnabled",
      "bannerTitle",
      "bannerText",
      "bannerImageData",
      "bannerImageRemove",
      "bannerTouch",
    ];
    if (bannerKeys.some((k) => k in body)) {
      const bp: BannerPatch = {};
      if ("bannerEnabled" in body) {
        if (typeof body.bannerEnabled !== "boolean") {
          return NextResponse.json({ error: "bannerEnabled harus boolean." }, { status: 400 });
        }
        bp.bannerEnabled = body.bannerEnabled;
      }
      if ("bannerTitle" in body) {
        if (body.bannerTitle === null) {
          bp.bannerTitle = null;
        } else {
          const t = String(body.bannerTitle).trim();
          if (t.length > 60) {
            return NextResponse.json({ error: "Judul banner maksimal 60 karakter." }, { status: 400 });
          }
          bp.bannerTitle = t === "" ? null : t;
        }
      }
      if ("bannerText" in body) {
        if (body.bannerText === null) {
          bp.bannerText = null;
        } else {
          const t = String(body.bannerText).trim();
          if (t.length > 160) {
            return NextResponse.json({ error: "Pesan banner maksimal 160 karakter." }, { status: 400 });
          }
          bp.bannerText = t === "" ? null : t;
        }
      }
      if (body.bannerImageData != null) {
        // Validasi data URL gambar (pola & batas sama dengan foto menu)
        const m = String(body.bannerImageData).match(
          /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/
        );
        if (!m) {
          return NextResponse.json(
            { error: "Gambar banner harus berformat JPG, PNG, WEBP, atau GIF." },
            { status: 400 }
          );
        }
        if (m[2].length > 2_000_000) {
          return NextResponse.json(
            { error: "Gambar banner terlalu besar (maksimal ±1,5 MB setelah dikompres)." },
            { status: 400 }
          );
        }
        bp.bannerImageData = m[2];
        bp.bannerImageMime = m[1];
        bp.bannerTouch = true;
      }
      if (body.bannerImageRemove === true) {
        bp.bannerImageRemove = true;
        bp.bannerTouch = true;
      }
      if (body.bannerTouch === true) bp.bannerTouch = true;

      bannerResult = await updateBannerSettings(bp);
    }

    // ===== Hero banner halaman Menu =====
    let menuHeroResult: Awaited<ReturnType<typeof updateMenuHeroSettings>> | null = null;
    const menuHeroKeys = [
      "menuHeroEnabled",
      "menuHeroBadge",
      "menuHeroTitle",
      "menuHeroText",
      "menuHeroImageData",
      "menuHeroImageRemove",
      "menuHeroTouch",
    ];
    if (menuHeroKeys.some((k) => k in body)) {
      const hp: MenuHeroPatch = {};
      if ("menuHeroEnabled" in body) {
        if (typeof body.menuHeroEnabled !== "boolean") {
          return NextResponse.json({ error: "menuHeroEnabled harus boolean." }, { status: 400 });
        }
        hp.menuHeroEnabled = body.menuHeroEnabled;
      }
      const heroTextRules: Array<[
        "menuHeroBadge" | "menuHeroTitle" | "menuHeroText",
        number,
        string,
      ]> = [
        ["menuHeroBadge", 24, "Label hero menu maksimal 24 karakter."],
        ["menuHeroTitle", 80, "Judul hero menu maksimal 80 karakter."],
        ["menuHeroText", 120, "Pesan hero menu maksimal 120 karakter."],
      ];
      for (const [key, max, err] of heroTextRules) {
        if (key in body) {
          const t = String(body[key] ?? "").trim();
          if (t.length > max) {
            return NextResponse.json({ error: err }, { status: 400 });
          }
          hp[key] = t; // kosong = baris disembunyikan
        }
      }
      if (body.menuHeroImageData != null) {
        const m = String(body.menuHeroImageData).match(
          /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/
        );
        if (!m) {
          return NextResponse.json(
            { error: "Gambar hero harus berformat JPG, PNG, WEBP, atau GIF." },
            { status: 400 }
          );
        }
        if (m[2].length > 2_000_000) {
          return NextResponse.json(
            { error: "Gambar hero terlalu besar (maksimal ±1,5 MB setelah dikompres)." },
            { status: 400 }
          );
        }
        hp.menuHeroImageData = m[2];
        hp.menuHeroImageMime = m[1];
        hp.menuHeroTouch = true;
      }
      if (body.menuHeroImageRemove === true) {
        hp.menuHeroImageRemove = true;
        hp.menuHeroTouch = true;
      }
      if (body.menuHeroTouch === true) hp.menuHeroTouch = true;

      menuHeroResult = await updateMenuHeroSettings(hp);
    }

    // ===== Carousel promo Menu: slide voucher + 2 banner promo custom =====
    let menuPromoResult: Awaited<ReturnType<typeof updateMenuPromoSettings>> | null = null;
    const menuPromoKeys = ["menuPromoVouchersEnabled", "menuPromoVouchersMax", "menuPromoBanners"];
    if (menuPromoKeys.some((k) => k in body)) {
      const mp: MenuPromoPatch = {};
      if ("menuPromoVouchersEnabled" in body) {
        if (typeof body.menuPromoVouchersEnabled !== "boolean") {
          return NextResponse.json(
            { error: "menuPromoVouchersEnabled harus boolean." },
            { status: 400 }
          );
        }
        mp.menuPromoVouchersEnabled = body.menuPromoVouchersEnabled;
      }
      if ("menuPromoVouchersMax" in body) {
        const n = Number(body.menuPromoVouchersMax);
        if (!Number.isFinite(n) || n < 1 || n > 5) {
          return NextResponse.json(
            { error: "Jumlah slide voucher harus angka 1–5." },
            { status: 400 }
          );
        }
        mp.menuPromoVouchersMax = n;
      }
      if ("menuPromoBanners" in body) {
        const rawBanners = body.menuPromoBanners;
        if (!Array.isArray(rawBanners)) {
          return NextResponse.json(
            { error: "menuPromoBanners harus berupa array." },
            { status: 400 }
          );
        }
        const bannerPatches: MenuPromoBannerPatch[] = [];
        for (const raw of rawBanners) {
          const r = (raw ?? {}) as Record<string, unknown>;
          const slot = Number(r.slot);
          if (slot !== 1 && slot !== 2) {
            return NextResponse.json(
              { error: "Slot banner promo harus 1 atau 2." },
              { status: 400 }
            );
          }
          const bpatch: MenuPromoBannerPatch = { slot };
          if ("enabled" in r) {
            if (typeof r.enabled !== "boolean") {
              return NextResponse.json(
                { error: "enabled banner promo harus boolean." },
                { status: 400 }
              );
            }
            bpatch.enabled = r.enabled;
          }
          const bannerTextRules: Array<["badge" | "title" | "text", number, string]> = [
            ["badge", 24, "Label banner promo maksimal 24 karakter."],
            ["title", 80, "Judul banner promo maksimal 80 karakter."],
            ["text", 120, "Pesan banner promo maksimal 120 karakter."],
          ];
          for (const [key, max, err] of bannerTextRules) {
            if (key in r) {
              const t = String(r[key] ?? "").trim();
              if (t.length > max) {
                return NextResponse.json({ error: err }, { status: 400 });
              }
              bpatch[key] = t;
            }
          }
          if ("emoji" in r) {
            const e = String(r.emoji ?? "").trim();
            if (e.length > 8) {
              return NextResponse.json(
                { error: "Emoji banner promo maksimal 8 karakter." },
                { status: 400 }
              );
            }
            bpatch.emoji = e;
          }
          if ("theme" in r) {
            const th = String(r.theme ?? "");
            if (!(MENU_PROMO_BANNER_THEMES as readonly string[]).includes(th)) {
              return NextResponse.json(
                { error: "Tema warna banner promo tidak dikenal." },
                { status: 400 }
              );
            }
            bpatch.theme = th as MenuPromoBannerPatch["theme"];
          }
          if (r.imageData != null) {
            const m = String(r.imageData).match(
              /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/
            );
            if (!m) {
              return NextResponse.json(
                { error: "Gambar banner promo harus berformat JPG, PNG, WEBP, atau GIF." },
                { status: 400 }
              );
            }
            if (m[2].length > 2_000_000) {
              return NextResponse.json(
                { error: "Gambar banner promo terlalu besar (maksimal ±1,5 MB setelah dikompres)." },
                { status: 400 }
              );
            }
            bpatch.imageData = m[2];
            bpatch.imageMime = m[1];
          }
          if (r.imageRemove === true) bpatch.imageRemove = true;
          bannerPatches.push(bpatch);
        }
        mp.banners = bannerPatches;
      }
      menuPromoResult = await updateMenuPromoSettings(mp);
    }

    // ===== Strip promo hari ini (Beranda) =====
    let promoResult: Awaited<ReturnType<typeof updatePromoStripSettings>> | null = null;
    const promoKeys = ["promoStripEnabled", "promoStripBadge", "promoStripTitle", "promoStripText"];
    if (promoKeys.some((k) => k in body)) {
      const pp: PromoStripPatch = {};
      if ("promoStripEnabled" in body) {
        if (typeof body.promoStripEnabled !== "boolean") {
          return NextResponse.json({ error: "promoStripEnabled harus boolean." }, { status: 400 });
        }
        pp.promoStripEnabled = body.promoStripEnabled;
      }
      const promoTextRules: Array<["promoStripBadge" | "promoStripTitle" | "promoStripText", number, string]> = [
        ["promoStripBadge", 24, "Label strip promo maksimal 24 karakter."],
        ["promoStripTitle", 80, "Judul strip promo maksimal 80 karakter."],
        ["promoStripText", 120, "Pesan strip promo maksimal 120 karakter."],
      ];
      for (const [key, max, err] of promoTextRules) {
        if (key in body) {
          const t = String(body[key] ?? "").trim();
          if (t.length > max) {
            return NextResponse.json({ error: err }, { status: 400 });
          }
          pp[key] = t; // kosong = baris disembunyikan
        }
      }
      promoResult = await updatePromoStripSettings(pp);
    }

    if (
      Object.keys(patch).length === 0 &&
      !bannerResult &&
      !promoResult &&
      !menuHeroResult &&
      !menuPromoResult
    ) {
      return NextResponse.json(
        { error: "Tidak ada pengaturan yang diubah." },
        { status: 400 }
      );
    }

    const banner = bannerResult ?? (await getBannerSettings());
    const menuHero = menuHeroResult ?? (await getMenuHeroSettings());
    return NextResponse.json({
      settings: { ...(await getStoreSettings()) },
      banner: {
        ...banner,
        bannerImageUrl:
          banner.bannerEnabled && banner.bannerHasImage
            ? `/api/settings/banner/image?v=${encodeURIComponent(banner.bannerVersion ?? "1")}`
            : null,
      },
      promo: promoResult ?? (await getPromoStripSettings()),
      menuHero: {
        ...menuHero,
        menuHeroImageUrl: menuHeroImageUrl(
          menuHero.menuHeroHasImage,
          menuHero.menuHeroEnabled,
          menuHero.menuHeroVersion
        ),
      },
      menuPromo: menuPromoResult ?? (await getMenuPromoSettings()),
    });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
