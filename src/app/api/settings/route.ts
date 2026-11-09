import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import {
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
 * plus setelan slide voucher di carousel Menu (menuPromo).
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
      menuPromo,
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
 * Body mPromo : { menuPromoVouchersEnabled?, menuPromoVouchersMax? } — slide voucher di carousel Menu
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

    // ===== Slide voucher di carousel Menu =====
    let menuPromoResult: Awaited<ReturnType<typeof updateMenuPromoSettings>> | null = null;
    const menuPromoKeys = ["menuPromoVouchersEnabled", "menuPromoVouchersMax"];
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
