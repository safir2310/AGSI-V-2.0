/**
 * Pengaturan toko AGSI (tabel StoreSetting, satu baris id "main").
 *
 * Sumber tunggal saklar layanan yang dikendalikan admin/owner dari halaman
 * Profil → "Pengaturan Toko":
 *  - deliveryEnabled: layanan antar pesanan (type DELIVERY)
 *  - qrisEnabled    : pembayaran QRIS
 * Dinonaktifkan → opsi disembunyikan di UI pelanggan/POS DAN ditolak
 * server-side saat checkout (lihat POST /api/orders).
 */
import { db } from "@/lib/db";

export type StoreSettings = {
  deliveryEnabled: boolean;
  qrisEnabled: boolean;
};

/** Konten popup banner beranda (disimpan di baris StoreSetting yang sama). */
export type BannerSettings = {
  bannerEnabled: boolean;
  bannerTitle: string | null;
  bannerText: string | null;
  bannerHasImage: boolean;
  /** ISO timestamp terakhir konten banner diubah — dipakai sbg versi (cache-buster & kunci "sudah tampil" sesi) */
  bannerVersion: string | null;
};

/** Ambil pengaturan toko — baris dibuat otomatis (default aktif semua) bila belum ada. */
export async function getStoreSettings(): Promise<StoreSettings> {
  const row = await db.storeSetting.upsert({
    where: { id: "main" },
    update: {},
    create: { id: "main" },
  });
  return { deliveryEnabled: row.deliveryEnabled, qrisEnabled: row.qrisEnabled };
}

/** Konten strip "Promo Hari Ini" di Beranda (disimpan di baris StoreSetting yang sama). */
export type PromoStripSettings = {
  promoStripEnabled: boolean;
  /** label kecil di atas judul — string kosong = baris disembunyikan */
  promoStripBadge: string;
  /** baris utama strip — string kosong = baris disembunyikan */
  promoStripTitle: string;
  /** baris penjelas — string kosong = baris disembunyikan */
  promoStripText: string;
};

/** Ambil konten popup banner beranda (publik — tanpa bytes gambar). */
export async function getBannerSettings(): Promise<BannerSettings> {
  const row = await db.storeSetting.upsert({
    where: { id: "main" },
    update: {},
    create: { id: "main" },
  });
  return {
    bannerEnabled: row.bannerEnabled,
    bannerTitle: row.bannerTitle,
    bannerText: row.bannerText,
    bannerHasImage: !!(row.bannerImageData && row.bannerImageMime),
    bannerVersion: row.bannerUpdatedAt ? row.bannerUpdatedAt.toISOString() : null,
  };
}

/** Ambil konten strip promo hari ini (publik). */
export async function getPromoStripSettings(): Promise<PromoStripSettings> {
  const row = await db.storeSetting.upsert({
    where: { id: "main" },
    update: {},
    create: { id: "main" },
  });
  return {
    promoStripEnabled: row.promoStripEnabled,
    promoStripBadge: row.promoStripBadge,
    promoStripTitle: row.promoStripTitle,
    promoStripText: row.promoStripText,
  };
}

export type BannerPatch = {
  bannerEnabled?: boolean;
  bannerTitle?: string | null;
  bannerText?: string | null;
  /** data URL gambar baru ("data:image/png;base64,...") */
  bannerImageData?: string;
  bannerImageMime?: string;
  /** true = hapus gambar banner */
  bannerImageRemove?: boolean;
  /** tandai konten banner berubah (naikkan versi agar popup tampil lagi) */
  bannerTouch?: boolean;
};

/** Simpan sebagian pengaturan toko (hanya field yang dikirim yang berubah). */
export async function updateStoreSettings(
  patch: Partial<{ deliveryEnabled: boolean; qrisEnabled: boolean }>
): Promise<StoreSettings> {
  const row = await db.storeSetting.upsert({
    where: { id: "main" },
    update: {
      ...(typeof patch.deliveryEnabled === "boolean" ? { deliveryEnabled: patch.deliveryEnabled } : {}),
      ...(typeof patch.qrisEnabled === "boolean" ? { qrisEnabled: patch.qrisEnabled } : {}),
    },
    create: {
      id: "main",
      ...(typeof patch.deliveryEnabled === "boolean" ? { deliveryEnabled: patch.deliveryEnabled } : {}),
      ...(typeof patch.qrisEnabled === "boolean" ? { qrisEnabled: patch.qrisEnabled } : {}),
    },
  });
  return { deliveryEnabled: row.deliveryEnabled, qrisEnabled: row.qrisEnabled };
}

/** Simpan sebagian konten popup banner beranda. */
export async function updateBannerSettings(patch: BannerPatch): Promise<BannerSettings> {
  const data: Record<string, unknown> = {};
  if (typeof patch.bannerEnabled === "boolean") data.bannerEnabled = patch.bannerEnabled;
  if (patch.bannerTitle !== undefined) data.bannerTitle = patch.bannerTitle;
  if (patch.bannerText !== undefined) data.bannerText = patch.bannerText;
  if (patch.bannerImageData !== undefined) data.bannerImageData = patch.bannerImageData;
  if (patch.bannerImageMime !== undefined) data.bannerImageMime = patch.bannerImageMime;
  if (patch.bannerImageRemove) {
    data.bannerImageData = null;
    data.bannerImageMime = null;
  }
  // Konten banner berubah → naikkan versi agar popup muncul lagi di sesi pelanggan
  if (patch.bannerTouch) data.bannerUpdatedAt = new Date();

  await db.storeSetting.upsert({
    where: { id: "main" },
    update: data,
    create: { id: "main", ...data },
  });
  return getBannerSettings();
}

export type PromoStripPatch = {
  promoStripEnabled?: boolean;
  promoStripBadge?: string;
  promoStripTitle?: string;
  promoStripText?: string;
};

/** Simpan sebagian konten strip promo hari ini di Beranda. */
export async function updatePromoStripSettings(patch: PromoStripPatch): Promise<PromoStripSettings> {
  const data: Record<string, unknown> = {};
  if (typeof patch.promoStripEnabled === "boolean") data.promoStripEnabled = patch.promoStripEnabled;
  if (patch.promoStripBadge !== undefined) data.promoStripBadge = patch.promoStripBadge.trim();
  if (patch.promoStripTitle !== undefined) data.promoStripTitle = patch.promoStripTitle.trim();
  if (patch.promoStripText !== undefined) data.promoStripText = patch.promoStripText.trim();

  await db.storeSetting.upsert({
    where: { id: "main" },
    update: data,
    create: { id: "main", ...data },
  });
  return getPromoStripSettings();
}

/* ================= HERO BANNER HALAMAN MENU ================= */

/** Konten hero banner promo di atas daftar menu (disimpan di baris StoreSetting yang sama). */
export type MenuHeroSettings = {
  menuHeroEnabled: boolean;
  /** label kecil di atas judul — string kosong = baris disembunyikan */
  menuHeroBadge: string;
  /** judul utama hero — string kosong = disembunyikan */
  menuHeroTitle: string;
  /** baris penjelas — string kosong = disembunyikan */
  menuHeroText: string;
  menuHeroHasImage: boolean;
  /** ISO timestamp terakhir konten hero diubah — cache-buster URL gambar */
  menuHeroVersion: string | null;
};

/** Ambil konten hero banner menu (publik — tanpa bytes gambar). */
export async function getMenuHeroSettings(): Promise<MenuHeroSettings> {
  const row = await db.storeSetting.upsert({
    where: { id: "main" },
    update: {},
    create: { id: "main" },
  });
  return {
    menuHeroEnabled: row.menuHeroEnabled,
    menuHeroBadge: row.menuHeroBadge,
    menuHeroTitle: row.menuHeroTitle,
    menuHeroText: row.menuHeroText,
    menuHeroHasImage: !!(row.menuHeroImageData && row.menuHeroImageMime),
    menuHeroVersion: row.menuHeroUpdatedAt ? row.menuHeroUpdatedAt.toISOString() : null,
  };
}

export type MenuHeroPatch = {
  menuHeroEnabled?: boolean;
  menuHeroBadge?: string;
  menuHeroTitle?: string;
  menuHeroText?: string;
  /** data URL gambar baru ("data:image/png;base64,...") */
  menuHeroImageData?: string;
  menuHeroImageMime?: string;
  /** true = hapus gambar hero */
  menuHeroImageRemove?: boolean;
  /** tandai konten hero berubah (naikkan versi agar cache gambar segar) */
  menuHeroTouch?: boolean;
};

/* ================= SLIDE VOUCHER + 2 BANNER PROMO DI CAROUSEL MENU ================= */

/**
 * Setelan carousel promo halaman Menu.
 * Carousel berganti OTOMATIS (tiap 4 detik) dengan urutan:
 *   slide hero (konten admin) → banner promo 1 → banner promo 2 → voucher aktif.
 * Bagian voucher bisa disembunyikan/dibatasi, dan 2 banner promo custom
 * (slot 1 & 2) kontennya dapat diganti-ganti admin dari Profil Admin →
 * "Banner & Promo".
 */
export const MENU_PROMO_BANNER_THEMES = ["orange", "rose", "emerald", "blue", "violet"] as const;
export type MenuPromoBannerTheme = (typeof MENU_PROMO_BANNER_THEMES)[number];

/** Konten 1 banner promo custom (disimpan di kolom JSON menuPromoBanners). */
export type MenuPromoBannerConfig = {
  enabled: boolean;
  /** label kecil di atas judul — string kosong = baris disembunyikan */
  badge: string;
  /** judul utama banner — string kosong = disembunyikan */
  title: string;
  /** baris penjelas — string kosong = disembunyikan */
  text: string;
  /** emoji dekorasi mengapung (maks 8 karakter) */
  emoji: string;
  /** tema gradien latar (dipakai bila tanpa gambar) */
  theme: MenuPromoBannerTheme;
};

/** Isi awal 2 banner promo — konsisten dengan FALLBACK di hooks.ts. */
export const DEFAULT_MENU_PROMO_BANNERS: MenuPromoBannerConfig[] = [
  {
    enabled: true,
    badge: "Promo Spesial",
    title: "Beli 2 Gratis 1 Es Teh",
    text: "Berlaku setiap hari kerja di outlet AGSI",
    emoji: "🥤",
    theme: "violet",
  },
  {
    enabled: true,
    badge: "Menu Baru",
    title: "Ayam Geprik Sambal Bawang",
    text: "Pedas nampol, harga hemat mulai Rp 15.000",
    emoji: "🌶️",
    theme: "emerald",
  },
];

/** Konfigurasi 1 banner slot + status gambarnya (respons publik). */
export type MenuPromoBannerSlot = MenuPromoBannerConfig & {
  slot: 1 | 2;
  hasImage: boolean;
};

export type MenuPromoSettings = {
  /** tampilkan slide voucher aktif di carousel Menu */
  menuPromoVouchersEnabled: boolean;
  /** jumlah maksimal slide voucher (1–5) */
  menuPromoVouchersMax: number;
  /** konfigurasi 2 banner promo custom — SELALU tepat 2 entri (slot 1 & 2) */
  banners: MenuPromoBannerSlot[];
  /** ISO timestamp konten banner promo terakhir diubah — cache-buster URL gambar */
  version: string | null;
};

/** Normalisasi 1 entri konfigurasi banner dari JSON DB → bentuk aman. */
function normalizeBannerConfig(raw: unknown, index: 0 | 1): MenuPromoBannerConfig {
  const r = (raw ?? {}) as Partial<MenuPromoBannerConfig>;
  const def = DEFAULT_MENU_PROMO_BANNERS[index];
  return {
    enabled: r.enabled !== false,
    badge: typeof r.badge === "string" ? r.badge.slice(0, 24) : def.badge,
    title: typeof r.title === "string" ? r.title.slice(0, 80) : def.title,
    text: typeof r.text === "string" ? r.text.slice(0, 120) : def.text,
    emoji: typeof r.emoji === "string" && r.emoji.trim() ? r.emoji.trim().slice(0, 8) : def.emoji,
    theme: (MENU_PROMO_BANNER_THEMES as readonly string[]).includes(r.theme ?? "")
      ? (r.theme as MenuPromoBannerTheme)
      : def.theme,
  };
}

/** Baca kolom JSON menuPromoBanners → selalu tepat 2 konfigurasi valid. */
function readMenuPromoBanners(raw: unknown): MenuPromoBannerConfig[] {
  const arr = Array.isArray(raw) ? raw : [];
  return [normalizeBannerConfig(arr[0], 0), normalizeBannerConfig(arr[1], 1)];
}

/** Ambil setelan carousel promo menu (publik — tanpa bytes gambar). */
export async function getMenuPromoSettings(): Promise<MenuPromoSettings> {
  const row = await db.storeSetting.upsert({
    where: { id: "main" },
    update: {},
    create: { id: "main" },
  });
  const banners = readMenuPromoBanners(row.menuPromoBanners);
  return {
    menuPromoVouchersEnabled: row.menuPromoVouchersEnabled,
    menuPromoVouchersMax: row.menuPromoVouchersMax,
    banners: banners.map((c, i) => ({
      ...c,
      slot: (i + 1) as 1 | 2,
      hasImage: i === 0
        ? !!(row.menuPromoBanner1ImageData && row.menuPromoBanner1ImageMime)
        : !!(row.menuPromoBanner2ImageData && row.menuPromoBanner2ImageMime),
    })),
    version: row.menuPromoBannersUpdatedAt ? row.menuPromoBannersUpdatedAt.toISOString() : null,
  };
}

/** Patch 1 banner promo slot (dipakai route PUT setelah divalidasi). */
export type MenuPromoBannerPatch = {
  slot: 1 | 2;
  enabled?: boolean;
  badge?: string;
  title?: string;
  text?: string;
  emoji?: string;
  theme?: MenuPromoBannerTheme;
  /** base64 murni gambar latar baru (tanpa prefiks data URL) */
  imageData?: string;
  imageMime?: string;
  /** true = hapus gambar latar slot ini */
  imageRemove?: boolean;
};

export type MenuPromoPatch = {
  menuPromoVouchersEnabled?: boolean;
  menuPromoVouchersMax?: number;
  /** patch per slot banner promo (slot 1 & 2) */
  banners?: MenuPromoBannerPatch[];
};

/** Simpan sebagian setelan carousel promo menu (saklar voucher + 2 banner promo). */
export async function updateMenuPromoSettings(patch: MenuPromoPatch): Promise<MenuPromoSettings> {
  const data: Record<string, unknown> = {};
  if (typeof patch.menuPromoVouchersEnabled === "boolean") {
    data.menuPromoVouchersEnabled = patch.menuPromoVouchersEnabled;
  }
  if (typeof patch.menuPromoVouchersMax === "number" && Number.isFinite(patch.menuPromoVouchersMax)) {
    // Jepit ke rentang valid 1–5 (server-side clamp, UI juga membatasi)
    data.menuPromoVouchersMax = Math.min(5, Math.max(1, Math.round(patch.menuPromoVouchersMax)));
  }
  if (Array.isArray(patch.banners) && patch.banners.length > 0) {
    const existing = await db.storeSetting.upsert({
      where: { id: "main" },
      update: {},
      create: { id: "main" },
    });
    const configs = readMenuPromoBanners(existing.menuPromoBanners);
    const imageCols: Record<string, unknown> = {};
    for (const b of patch.banners) {
      const idx: 0 | 1 = b.slot === 2 ? 1 : 0;
      const cfg = configs[idx];
      if (!cfg) continue;
      if (typeof b.enabled === "boolean") cfg.enabled = b.enabled;
      if (b.badge !== undefined) cfg.badge = b.badge.trim().slice(0, 24);
      if (b.title !== undefined) cfg.title = b.title.trim().slice(0, 80);
      if (b.text !== undefined) cfg.text = b.text.trim().slice(0, 120);
      if (b.emoji !== undefined) {
        cfg.emoji = b.emoji.trim().slice(0, 8) || DEFAULT_MENU_PROMO_BANNERS[idx].emoji;
      }
      if (b.theme && (MENU_PROMO_BANNER_THEMES as readonly string[]).includes(b.theme)) {
        cfg.theme = b.theme;
      }
      const col = idx === 0 ? "1" : "2";
      if (b.imageData && b.imageMime) {
        imageCols[`menuPromoBanner${col}ImageData`] = b.imageData;
        imageCols[`menuPromoBanner${col}ImageMime`] = b.imageMime;
      }
      if (b.imageRemove) {
        imageCols[`menuPromoBanner${col}ImageData`] = null;
        imageCols[`menuPromoBanner${col}ImageMime`] = null;
      }
    }
    data.menuPromoBanners = configs;
    // Konten banner promo berubah → naikkan versi agar URL gambar (?v=…) segar
    data.menuPromoBannersUpdatedAt = new Date();
    Object.assign(data, imageCols);
  }

  await db.storeSetting.upsert({
    where: { id: "main" },
    update: data,
    create: { id: "main", ...data },
  });
  return getMenuPromoSettings();
}

/** Simpan sebagian konten hero banner menu. */
export async function updateMenuHeroSettings(patch: MenuHeroPatch): Promise<MenuHeroSettings> {
  const data: Record<string, unknown> = {};
  if (typeof patch.menuHeroEnabled === "boolean") data.menuHeroEnabled = patch.menuHeroEnabled;
  if (patch.menuHeroBadge !== undefined) data.menuHeroBadge = patch.menuHeroBadge.trim();
  if (patch.menuHeroTitle !== undefined) data.menuHeroTitle = patch.menuHeroTitle.trim();
  if (patch.menuHeroText !== undefined) data.menuHeroText = patch.menuHeroText.trim();
  if (patch.menuHeroImageData !== undefined) data.menuHeroImageData = patch.menuHeroImageData;
  if (patch.menuHeroImageMime !== undefined) data.menuHeroImageMime = patch.menuHeroImageMime;
  if (patch.menuHeroImageRemove) {
    data.menuHeroImageData = null;
    data.menuHeroImageMime = null;
  }
  // Konten berubah → naikkan versi agar URL gambar (?v=…) tidak ter-cache lama
  if (patch.menuHeroTouch) data.menuHeroUpdatedAt = new Date();

  await db.storeSetting.upsert({
    where: { id: "main" },
    update: data,
    create: { id: "main", ...data },
  });
  return getMenuHeroSettings();
}
