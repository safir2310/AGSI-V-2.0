import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { defaultMotionDoc, type MotionPublic } from "@/lib/motion-config";
import {
  COURIER_ANIM_COLORS,
  COURIER_ANIM_FONTS,
  COURIER_ANIM_WEIGHTS,
  COURIER_ANIM_TEXT_MAX,
  COURIER_ANIM_FONT_MIN,
  COURIER_ANIM_FONT_MAX,
  COURIER_ANIM_CYCLE_MIN,
  COURIER_ANIM_CYCLE_MAX,
  COURIER_ANIM_STYLES,
  DEFAULT_COURIER_ANIM,
  MENU_PROMO_BANNER_THEMES,
  getBannerSettings,
  getCourierAnimSettings,
  getMotionDoc,
  getMenuHeroSettings,
  getMenuPromoSettings,
  getPromoStripSettings,
  getStoreSettings,
  getStoreSettingsSnapshot,
  getVideoPromoSettings,
  updateBannerSettings,
  updateCourierAnimSettings,
  updateMenuHeroSettings,
  updateMenuPromoSettings,
  updatePromoStripSettings,
  updateStoreSettings,
  updateVideoPromoSettings,
  motionPublicOf,
  updateMotionSettings,
  VIDEO_PROMO_MAX_SLIDES,
  type BannerPatch,
  type CourierAnimPatch,
  type MenuHeroPatch,
  type MenuPromoBannerPatch,
  type MenuPromoPatch,
  type PromoStripPatch,
  type VideoPromoSlideConfig,
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
// WAJIB dinamis: respons harus membaca DB live — data banner/promo berubah
// kapan saja dari halaman admin. Tanpa ini Next dapat membekukan respons.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // SATU query read-only untuk semua bagian (dulu 6 upsert paralel ke baris
    // yang sama → saling menunggu kunci tulis hingga timeout pool ±10 dtk →
    // respons selalu fallback: bannerEnabled=false & semua hasImage=false →
    // banner/promo tersimpan tidak pernah muncul).
    const snap = await getStoreSettingsSnapshot();
    // Dokumen penuh Motion Studio (draft + preset + riwayat + jadwal) HANYA
    // untuk admin/owner — pengunjung cukup ringkasan publik `motion`.
    let motionStudio: unknown = undefined;
    const viewer = await getCurrentUser();
    if (viewer && isAdminRole(viewer.role)) {
      motionStudio = await getMotionDoc();
    }
    return NextResponse.json({
      ...snap.settings,
      banner: {
        ...snap.banner,
        bannerImageUrl:
          snap.banner.bannerEnabled && snap.banner.bannerHasImage
            ? `/api/settings/banner/image?v=${encodeURIComponent(snap.banner.bannerVersion ?? "1")}`
            : null,
      },
      promo: snap.promo,
      menuHero: {
        ...snap.menuHero,
        menuHeroImageUrl: menuHeroImageUrl(
          snap.menuHero.menuHeroHasImage,
          snap.menuHero.menuHeroEnabled,
          snap.menuHero.menuHeroVersion
        ),
      },
      menuPromo: {
        ...snap.menuPromo,
        banners: snap.menuPromo.banners.map((b) => ({
          ...b,
          imageUrl:
            b.enabled && b.hasImage
              ? `/api/settings/menu-promo/image?slot=${b.slot}&v=${encodeURIComponent(snap.menuPromo.version ?? "1")}`
              : null,
        })),
      },
      // AGSI Smart Video Promo Banner — carousel video di dasar halaman Menu
      // (bytes video terpisah via /api/settings/video-promo/video?slot=1..3)
      videoPromo: {
        ...snap.videoPromo,
        slides: snap.videoPromo.slides.map((s) => ({
          ...s,
          videoUrl:
            snap.videoPromo.enabled && s.enabled && s.hasVideo
              ? `/api/settings/video-promo/video?slot=${s.slot}&v=${encodeURIComponent(snap.videoPromo.version ?? "1")}`
              : null,
        })),
      },
      // Adegan animasi kurir + tipografi kinetik Beranda (konfigurasi kecil,
      // aman ikut snapshot publik — tanpa bytes media)
      courierAnim: snap.courierAnim,
      // AGSI Motion Studio — ringkasan publik (jadwal dievaluasi server)
      motion: snap.motion,
      // Dokumen penuh utk studio (hanya ada di respons utk Admin/Owner)
      motionStudio,
    });
  } catch {
    return NextResponse.json(
      {
        deliveryEnabled: true,
        qrisEnabled: true,
        ewalletEnabled: true,
        payVaEnabled: true,
        payCardEnabled: true,
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
        videoPromo: {
          enabled: false,
          version: null,
          slides: [1, 2, 3].map((slot) => ({
            slot,
            enabled: true,
            title: "",
            linkType: "none",
            productId: null,
            hasVideo: false,
            mime: null,
            videoUrl: null,
          })),
        },
        // Adegan animasi kurir + tipografi kinetik Beranda (konfigurasi bawaan)
        courierAnim: { ...DEFAULT_COURIER_ANIM },
        // AGSI Motion Studio (konfigurasi bawaan)
        motion: motionPublicOf(defaultMotionDoc()),
      },
      { status: 200 }
    );
  }
}

/**
 * PUT /api/settings — ubah saklar layanan & konten banner (KHUSUS Admin/Owner).
 * Body saklar : { deliveryEnabled?: boolean, qrisEnabled?: boolean, ewalletEnabled?: boolean }
 * Body banner : { bannerEnabled?, bannerTitle?, bannerText?, bannerImageData?, bannerImageRemove?, bannerTouch? }
 * Body promo  : { promoStripEnabled?, promoStripBadge?, promoStripTitle?, promoStripText? }
 * Body hero   : { menuHeroEnabled?, menuHeroBadge?, menuHeroTitle?, menuHeroText?, menuHeroImageData?, menuHeroImageRemove?, menuHeroTouch? }
 * Body mPromo : { menuPromoVouchersEnabled?, menuPromoVouchersMax?, menuPromoBanners?: [...] } —
 *               carousel promo Menu: slide voucher + 2 banner promo custom
 *               (menuPromoBanners: [{ slot: 1|2, enabled?, badge?, title?, text?, emoji?, theme?, imageData?, imageRemove? }])
 * Body anim   : { courierAnim?: { enabled?, text?, font?, weight?, caps?, italic?, fontSize?, textColor?, accentColor?, cycleSec?, boom? } } —
 *               adegan animasi kurir + tipografi kinetik di Beranda
 * Body motion : { motion?: { kind: "draft"|"publish"|"restore"|"reset", global?, targets?, version? } } —
 *               AGSI Motion Studio: simpan DRAFT, PUBLIKASIKAN (versi+riwayat),
 *               RESTORE versi riwayat, atau RESET ke bawaan
 */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 403 });
  }

  try {
    const body = await req.json();
    const patch: {
      deliveryEnabled?: boolean;
      qrisEnabled?: boolean;
      ewalletEnabled?: boolean;
      payVaEnabled?: boolean;
      payCardEnabled?: boolean;
    } = {};

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
    if ("ewalletEnabled" in body) {
      if (typeof body.ewalletEnabled !== "boolean") {
        return NextResponse.json(
          { error: "ewalletEnabled harus boolean." },
          { status: 400 }
        );
      }
      patch.ewalletEnabled = body.ewalletEnabled;
    }
    // Saklar grup kanal halaman "Metode Pembayaran" (JSON payChannels)
    if ("payVaEnabled" in body) {
      if (typeof body.payVaEnabled !== "boolean") {
        return NextResponse.json(
          { error: "payVaEnabled harus boolean." },
          { status: 400 }
        );
      }
      patch.payVaEnabled = body.payVaEnabled;
    }
    if ("payCardEnabled" in body) {
      if (typeof body.payCardEnabled !== "boolean") {
        return NextResponse.json(
          { error: "payCardEnabled harus boolean." },
          { status: 400 }
        );
      }
      patch.payCardEnabled = body.payCardEnabled;
    }

    if (Object.keys(patch).length > 0) {
      await updateStoreSettings(patch);
    }

    // ===== AGSI Smart Video Promo Banner (metadata — bytes video via /api/settings/video-promo) =====
    // v1.3.32 — hasil update DIHITUNG di penjaga akhir: sebelumnya request
    // yang HANYA berisi videoPromo (Simpan Banner & Promo kini paralel per
    // bagian) tersimpan ke DB tetap dijawab 400 "Tidak ada pengaturan yang
    // diubah." karena hasilnya tidak ikut diperiksa → sheet melaporkan gagal.
    let videoPromoResult: Awaited<ReturnType<typeof updateVideoPromoSettings>> | null = null;
    if ("videoPromoEnabled" in body || "videoPromoSlides" in body) {
      const vp: { enabled?: boolean; slides?: VideoPromoSlideConfig[]; touch: boolean } = { touch: true };
      if ("videoPromoEnabled" in body) {
        if (typeof body.videoPromoEnabled !== "boolean") {
          return NextResponse.json({ error: "videoPromoEnabled harus boolean." }, { status: 400 });
        }
        vp.enabled = body.videoPromoEnabled;
      }
      if ("videoPromoSlides" in body) {
        if (!Array.isArray(body.videoPromoSlides) || body.videoPromoSlides.length > VIDEO_PROMO_MAX_SLIDES) {
          return NextResponse.json(
            { error: `videoPromoSlides harus array maksimal ${VIDEO_PROMO_MAX_SLIDES} slide.` },
            { status: 400 }
          );
        }
        vp.slides = body.videoPromoSlides.map((r: unknown, i: number) => {
          const s = (r ?? {}) as Partial<VideoPromoSlideConfig>;
          return {
            slot: i + 1,
            enabled: s.enabled !== false,
            title: typeof s.title === "string" ? s.title : "",
            linkType: s.linkType === "product" || s.linkType === "promo" ? s.linkType : "none",
            productId: typeof s.productId === "string" ? s.productId : null,
          };
        });
      }
      videoPromoResult = await updateVideoPromoSettings(vp);
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

    // ===== Animasi kurir + tipografi kinetik Beranda (satu objek JSON) =====
    let courierAnimResult: Awaited<ReturnType<typeof updateCourierAnimSettings>> | null = null;
    if ("courierAnim" in body) {
      const raw = body.courierAnim;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return NextResponse.json({ error: "courierAnim harus berupa objek." }, { status: 400 });
      }
      const c = raw as Record<string, unknown>;
      const cap: CourierAnimPatch = {};
      if ("enabled" in c) {
        if (typeof c.enabled !== "boolean") {
          return NextResponse.json({ error: "courierAnim.enabled harus boolean." }, { status: 400 });
        }
        cap.enabled = c.enabled;
      }
      if ("text" in c) {
        const t = String(c.text ?? "").trim();
        if (t.length > COURIER_ANIM_TEXT_MAX) {
          return NextResponse.json(
            { error: `Teks spanduk maksimal ${COURIER_ANIM_TEXT_MAX} karakter.` },
            { status: 400 }
          );
        }
        cap.text = t || DEFAULT_COURIER_ANIM.text; // kosong → kembali ke teks bawaan
      }
      if ("font" in c) {
        if (!(COURIER_ANIM_FONTS as readonly string[]).includes(String(c.font))) {
          return NextResponse.json({ error: "Font teks tidak dikenal." }, { status: 400 });
        }
        cap.font = String(c.font) as CourierAnimPatch["font"];
      }
      if ("weight" in c) {
        if (!(COURIER_ANIM_WEIGHTS as readonly string[]).includes(String(c.weight))) {
          return NextResponse.json({ error: "Ketebalan teks tidak dikenal." }, { status: 400 });
        }
        cap.weight = String(c.weight) as CourierAnimPatch["weight"];
      }
      if ("caps" in c) {
        if (typeof c.caps !== "boolean") {
          return NextResponse.json({ error: "courierAnim.caps harus boolean." }, { status: 400 });
        }
        cap.caps = c.caps;
      }
      if ("italic" in c) {
        if (typeof c.italic !== "boolean") {
          return NextResponse.json({ error: "courierAnim.italic harus boolean." }, { status: 400 });
        }
        cap.italic = c.italic;
      }
      if ("fontSize" in c) {
        const n = Number(c.fontSize);
        if (!Number.isFinite(n) || n < COURIER_ANIM_FONT_MIN || n > COURIER_ANIM_FONT_MAX) {
          return NextResponse.json(
            { error: `Ukuran teks harus angka ${COURIER_ANIM_FONT_MIN}–${COURIER_ANIM_FONT_MAX}.` },
            { status: 400 }
          );
        }
        cap.fontSize = n;
      }
      if ("textColor" in c) {
        if (!(COURIER_ANIM_COLORS as readonly string[]).includes(String(c.textColor))) {
          return NextResponse.json({ error: "Warna teks tidak dikenal." }, { status: 400 });
        }
        cap.textColor = String(c.textColor) as CourierAnimPatch["textColor"];
      }
      if ("accentColor" in c) {
        if (!(COURIER_ANIM_COLORS as readonly string[]).includes(String(c.accentColor))) {
          return NextResponse.json({ error: "Warna aksen tidak dikenal." }, { status: 400 });
        }
        cap.accentColor = String(c.accentColor) as CourierAnimPatch["accentColor"];
      }
      if ("animStyle" in c) {
        if (!(COURIER_ANIM_STYLES as readonly string[]).includes(String(c.animStyle))) {
          return NextResponse.json({ error: "Gaya animasi tidak dikenal." }, { status: 400 });
        }
        cap.animStyle = String(c.animStyle) as CourierAnimPatch["animStyle"];
      }
      if ("cycleSec" in c) {
        const n = Number(c.cycleSec);
        if (!Number.isFinite(n) || n < COURIER_ANIM_CYCLE_MIN || n > COURIER_ANIM_CYCLE_MAX) {
          return NextResponse.json(
            { error: `Kecepatan siklus harus angka ${COURIER_ANIM_CYCLE_MIN}–${COURIER_ANIM_CYCLE_MAX} detik.` },
            { status: 400 }
          );
        }
        cap.cycleSec = n;
      }
      if ("boom" in c) {
        if (typeof c.boom !== "boolean") {
          return NextResponse.json({ error: "courierAnim.boom harus boolean." }, { status: 400 });
        }
        cap.boom = c.boom;
      }
      courierAnimResult = await updateCourierAnimSettings(cap);
    }

    // ===== AGSI MOTION STUDIO (satu jalur tulis: draft/publish/restore/reset) =====
    // Validasi akses SUDAH di atas (isAdminRole di server — status admin dari
    // client tidak pernah dipercaya). Semua konfigurasi lolos normalizeMotionDoc
    // di updateMotionSettings: hanya kunci efek dari katalog yang dikenal.
    let motionResult: MotionPublic | null = null;
    if ("motion" in body) {
      const m = (body.motion ?? {}) as {
        kind?: string;
        global?: unknown;
        targets?: unknown;
        version?: unknown;
        schedule?: unknown;
      };
      const by = user.name || user.email || "admin";
      if (m.kind === "draft") {
        if (typeof m.global !== "object" || typeof m.targets !== "object") {
          return NextResponse.json({ error: "Konfigurasi draft motion tidak valid." }, { status: 400 });
        }
        await updateMotionSettings({ kind: "draft", global: m.global, targets: m.targets }, by);
        motionResult = motionPublicOf(await getMotionDoc());
      } else if (m.kind === "publish") {
        motionResult = motionPublicOf(await updateMotionSettings({ kind: "publish" }, by));
      } else if (m.kind === "restore") {
        const v = Number(m.version);
        if (!Number.isFinite(v)) {
          return NextResponse.json({ error: "Versi restore tidak valid." }, { status: 400 });
        }
        const doc = await getMotionDoc();
        if (!doc.history.some((h) => h.version === v)) {
          return NextResponse.json({ error: "Versi tidak ditemukan dalam riwayat." }, { status: 400 });
        }
        motionResult = motionPublicOf(await updateMotionSettings({ kind: "restore", version: v }, by));
      } else if (m.kind === "reset") {
        motionResult = motionPublicOf(await updateMotionSettings({ kind: "reset" }, by));
      } else if (m.kind === "schedule") {
        if (typeof m.schedule !== "object" || m.schedule === null) {
          return NextResponse.json({ error: "Konfigurasi jadwal motion tidak valid." }, { status: 400 });
        }
        motionResult = motionPublicOf(await updateMotionSettings({ kind: "schedule", schedule: m.schedule }, by));
      } else {
        return NextResponse.json({ error: "Aksi motion tidak dikenal." }, { status: 400 });
      }
    }

    if (
      Object.keys(patch).length === 0 &&
      !bannerResult &&
      !promoResult &&
      !menuHeroResult &&
      !menuPromoResult &&
      !videoPromoResult &&
      !courierAnimResult &&
      !motionResult
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
      videoPromo: videoPromoResult ?? (await getVideoPromoSettings()),
      courierAnim: courierAnimResult ?? (await getCourierAnimSettings()),
      motion: motionResult ?? motionPublicOf(await getMotionDoc()),
    });
  } catch {
    return NextResponse.json({ error: "Terjadi kesalahan server." }, { status: 500 });
  }
}
