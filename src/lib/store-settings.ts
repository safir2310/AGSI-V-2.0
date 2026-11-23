/**
 * Pengaturan toko AGSI (tabel StoreSetting, satu baris id "main").
 *
 * Sumber tunggal saklar layanan yang dikendalikan admin/owner dari halaman
 * Profil → "Pengaturan Toko":
 *  - deliveryEnabled: layanan antar pesanan (type DELIVERY)
 *  - qrisEnabled    : pembayaran QRIS
 *  - ewalletEnabled : pembayaran e-wallet (halaman DOKU) — TERPISAH dari QRIS
 * Dinonaktifkan → opsi disembunyikan di UI pelanggan/POS DAN ditolak
 * server-side saat checkout (lihat POST /api/orders).
 */
import { db } from "@/lib/db";
import type { StoreSetting } from "@prisma/client";

/**
 * Baca baris pengaturan toko TANPA efek tulisan (findUnique murni).
 *
 * PENTING (akar bug "banner & promo tersimpan tidak muncul"): dulu semua
 * pembacaan memakai `upsert` — endpoint publik GET /api/settings menjalankan
 * 6 upsert PARALEL ke baris yang sama; di Prisma Postgres upsert adalah
 * operasi tulis yang saling berebut kunci baris/koneksi sampai melewati batas
 * ±10 detik connection pool → GET selalu jatuh ke blok catch (fallback:
 * bannerEnabled=false & semua hasImage=false) → banner/promo yang tersimpan
 * TIDAK PERNAH ditampilkan, padahal datanya sehat di database.
 * Kini pembacaan read-only murni (1 query cepat, tanpa kunci tulis);
 * pembuatan baris hanya terjadi di jalur tulis atau bila benar-benar belum ada.
 */
export async function readStoreSettingsRow(): Promise<StoreSetting> {
  const row = await db.storeSetting.findUnique({ where: { id: "main" } });
  if (row) return row;
  // Baris belum ada (instalasi baru) → buat sekali. Balapan antar request
  // aman: pelanggaran unik ditangkap lalu baris dibaca ulang.
  try {
    return await db.storeSetting.create({ data: { id: "main" } });
  } catch {
    const again = await db.storeSetting.findUnique({ where: { id: "main" } });
    if (!again) throw new Error("Baris pengaturan toko (StoreSetting id=main) gagal disiapkan.");
    return again;
  }
}

/** Baris hasil query meta: nama field sama dgn StoreSetting, kolom bytes diganti boolean. */
type StoreSettingsMetaRow = {
  deliveryEnabled: boolean;
  qrisEnabled: boolean;
  ewalletEnabled: boolean;
  bannerEnabled: boolean;
  bannerTitle: string | null;
  bannerText: string | null;
  bannerImageData: boolean; // true = ada gambar (bytes TIDAK dimuat)
  bannerUpdatedAt: Date | null;
  promoStripEnabled: boolean;
  promoStripBadge: string;
  promoStripTitle: string;
  promoStripText: string;
  menuHeroEnabled: boolean;
  menuHeroBadge: string;
  menuHeroTitle: string;
  menuHeroText: string;
  menuHeroImageData: boolean;
  menuHeroUpdatedAt: Date | null;
  menuPromoVouchersEnabled: boolean;
  menuPromoVouchersMax: number;
  menuPromoBanners: unknown;
  menuPromoBannersUpdatedAt: Date | null;
  menuPromoBanner1ImageData: boolean;
  menuPromoBanner2ImageData: boolean;
  videoPromoEnabled: boolean;
  videoPromoSlides: unknown;
  videoPromoUpdatedAt: Date | null;
  videoPromoSlot1Data: boolean;
  videoPromoSlot2Data: boolean;
  videoPromoSlot3Data: boolean;
  videoPromoSlot1Mime: string | null;
  videoPromoSlot2Mime: string | null;
  videoPromoSlot3Mime: string | null;
  courierAnim: unknown;
};

/** Bentuk mentah hasil $queryRaw (boolean bisa 1/0 di SQLite, tanggal bisa string, JSON bisa string). */
type RawMetaRow = {
  [K in keyof StoreSettingsMetaRow]: StoreSettingsMetaRow[K] extends boolean
    ? boolean | number
    : StoreSettingsMetaRow[K] extends Date | null
      ? Date | string | null
      : StoreSettingsMetaRow[K];
};

/**
 * Baris meta RINGAN untuk snapshot PUBLIK: SATU query read-only yang TIDAK
 * memuat bytes media (±9 MB base64 di produksi: 3 video + 4 gambar). Boolean
 * keberadaan bytes dihitung di SQL ("col IS NOT NULL AS col") — nama field
 * tetap sama dengan StoreSetting agar pemakai snapshot tak perlu diubah.
 * Dulu findUnique seluruh baris mengirim ±9 MB per request /api/settings.
 */
export async function readStoreSettingsMetaRow(): Promise<StoreSettingsMetaRow> {
  const query = () =>
    db.$queryRaw<RawMetaRow[]>`
      SELECT "deliveryEnabled", "qrisEnabled", "ewalletEnabled",
             "bannerEnabled", "bannerTitle", "bannerText",
             ("bannerImageData" IS NOT NULL) AS "bannerImageData", "bannerUpdatedAt",
             "promoStripEnabled", "promoStripBadge", "promoStripTitle", "promoStripText",
             "menuHeroEnabled", "menuHeroBadge", "menuHeroTitle", "menuHeroText",
             ("menuHeroImageData" IS NOT NULL) AS "menuHeroImageData", "menuHeroUpdatedAt",
             "menuPromoVouchersEnabled", "menuPromoVouchersMax",
             "menuPromoBanners", "menuPromoBannersUpdatedAt",
             ("menuPromoBanner1ImageData" IS NOT NULL) AS "menuPromoBanner1ImageData",
             ("menuPromoBanner2ImageData" IS NOT NULL) AS "menuPromoBanner2ImageData",
             "videoPromoEnabled", "videoPromoSlides", "videoPromoUpdatedAt",
             ("videoPromoSlot1Data" IS NOT NULL) AS "videoPromoSlot1Data",
             ("videoPromoSlot2Data" IS NOT NULL) AS "videoPromoSlot2Data",
             ("videoPromoSlot3Data" IS NOT NULL) AS "videoPromoSlot3Data",
             "videoPromoSlot1Mime", "videoPromoSlot2Mime", "videoPromoSlot3Mime",
             "courierAnim"
      FROM "StoreSetting" WHERE "id" = 'main' LIMIT 1`;

  let r = (await query())[0];
  if (!r) {
    // Instalasi baru: buat baris default sekali (pola sama dengan readStoreSettingsRow).
    try {
      await db.storeSetting.create({ data: { id: "main" } });
    } catch {
      // Baris dibuat request lain di saat bersamaan — aman dibaca ulang.
    }
    r = (await query())[0];
    if (!r) throw new Error("Baris pengaturan toko (StoreSetting id=main) gagal disiapkan.");
  }

  const asDate = (v: Date | string | null): Date | null =>
    v == null ? null : v instanceof Date ? v : new Date(v);
  const asBool = (v: unknown): boolean => v === true || v === 1;
  const asJson = (v: unknown): unknown => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  };
  return {
    deliveryEnabled: asBool(r.deliveryEnabled),
    qrisEnabled: asBool(r.qrisEnabled),
    ewalletEnabled: asBool(r.ewalletEnabled),
    bannerEnabled: asBool(r.bannerEnabled),
    bannerTitle: r.bannerTitle,
    bannerText: r.bannerText,
    bannerImageData: asBool(r.bannerImageData),
    bannerUpdatedAt: asDate(r.bannerUpdatedAt),
    promoStripEnabled: asBool(r.promoStripEnabled),
    promoStripBadge: r.promoStripBadge,
    promoStripTitle: r.promoStripTitle,
    promoStripText: r.promoStripText,
    menuHeroEnabled: asBool(r.menuHeroEnabled),
    menuHeroBadge: r.menuHeroBadge,
    menuHeroTitle: r.menuHeroTitle,
    menuHeroText: r.menuHeroText,
    menuHeroImageData: asBool(r.menuHeroImageData),
    menuHeroUpdatedAt: asDate(r.menuHeroUpdatedAt),
    menuPromoVouchersEnabled: asBool(r.menuPromoVouchersEnabled),
    menuPromoVouchersMax: r.menuPromoVouchersMax,
    menuPromoBanners: asJson(r.menuPromoBanners),
    menuPromoBannersUpdatedAt: asDate(r.menuPromoBannersUpdatedAt),
    menuPromoBanner1ImageData: asBool(r.menuPromoBanner1ImageData),
    menuPromoBanner2ImageData: asBool(r.menuPromoBanner2ImageData),
    videoPromoEnabled: asBool(r.videoPromoEnabled),
    videoPromoSlides: asJson(r.videoPromoSlides),
    videoPromoUpdatedAt: asDate(r.videoPromoUpdatedAt),
    videoPromoSlot1Data: asBool(r.videoPromoSlot1Data),
    videoPromoSlot2Data: asBool(r.videoPromoSlot2Data),
    videoPromoSlot3Data: asBool(r.videoPromoSlot3Data),
    videoPromoSlot1Mime: r.videoPromoSlot1Mime,
    videoPromoSlot2Mime: r.videoPromoSlot2Mime,
    videoPromoSlot3Mime: r.videoPromoSlot3Mime,
    courierAnim: asJson(r.courierAnim),
  };
}

/** Pastikan baris pengaturan ada SEBELUM `update` (pengganti pola `upsert`). */
async function ensureStoreRowForWrite(): Promise<void> {
  const row = await db.storeSetting.findUnique({ where: { id: "main" }, select: { id: true } });
  if (row) return;
  try {
    await db.storeSetting.create({ data: { id: "main" } });
  } catch {
    // Baris dibuat request lain di saat bersamaan — aman lanjut ke update.
  }
}

export type StoreSettings = {
  deliveryEnabled: boolean;
  qrisEnabled: boolean;
  ewalletEnabled: boolean;
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

/** Ambil pengaturan toko — read-only (baris dibuat di jalur tulis bila belum ada). */
export async function getStoreSettings(): Promise<StoreSettings> {
  const row = await readStoreSettingsRow();
  return {
    deliveryEnabled: row.deliveryEnabled,
    qrisEnabled: row.qrisEnabled,
    ewalletEnabled: row.ewalletEnabled,
  };
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
  const row = await readStoreSettingsRow();
  return {
    bannerEnabled: row.bannerEnabled,
    bannerTitle: row.bannerTitle,
    bannerText: row.bannerText,
    // Ada gambar = cukup DATA saja — mime tak wajib (baris lama tersimpan
    // build yang belum menulis mime; endpoint menetapkan Content-Type dari
    // magic bytes, lihat src/lib/serve-image.ts).
    bannerHasImage: !!row.bannerImageData,
    bannerVersion: row.bannerUpdatedAt ? row.bannerUpdatedAt.toISOString() : null,
  };
}

/** Ambil konten strip promo hari ini (publik). */
export async function getPromoStripSettings(): Promise<PromoStripSettings> {
  const row = await readStoreSettingsRow();
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
  patch: Partial<{ deliveryEnabled: boolean; qrisEnabled: boolean; ewalletEnabled: boolean }>
): Promise<StoreSettings> {
  const data = {
    ...(typeof patch.deliveryEnabled === "boolean" ? { deliveryEnabled: patch.deliveryEnabled } : {}),
    ...(typeof patch.qrisEnabled === "boolean" ? { qrisEnabled: patch.qrisEnabled } : {}),
    ...(typeof patch.ewalletEnabled === "boolean" ? { ewalletEnabled: patch.ewalletEnabled } : {}),
  };
  await ensureStoreRowForWrite();
  const row = await db.storeSetting.update({ where: { id: "main" }, data });
  return {
    deliveryEnabled: row.deliveryEnabled,
    qrisEnabled: row.qrisEnabled,
    ewalletEnabled: row.ewalletEnabled,
  };
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

  await ensureStoreRowForWrite();
  await db.storeSetting.update({ where: { id: "main" }, data });
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

  await ensureStoreRowForWrite();
  await db.storeSetting.update({ where: { id: "main" }, data });
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
  const row = await readStoreSettingsRow();
  return {
    menuHeroEnabled: row.menuHeroEnabled,
    menuHeroBadge: row.menuHeroBadge,
    menuHeroTitle: row.menuHeroTitle,
    menuHeroText: row.menuHeroText,
    menuHeroHasImage: !!row.menuHeroImageData,
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
  const row = await readStoreSettingsRow();
  const banners = readMenuPromoBanners(row.menuPromoBanners);
  return {
    menuPromoVouchersEnabled: row.menuPromoVouchersEnabled,
    menuPromoVouchersMax: row.menuPromoVouchersMax,
    banners: banners.map((c, i) => ({
      ...c,
      slot: (i + 1) as 1 | 2,
      // Data saja sudah cukup — mime tak wajib (baris lama, lihat serve-image.ts)
      hasImage: !!(i === 0 ? row.menuPromoBanner1ImageData : row.menuPromoBanner2ImageData),
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
    const existing = await readStoreSettingsRow();
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

  await ensureStoreRowForWrite();
  await db.storeSetting.update({ where: { id: "main" }, data });
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

  await ensureStoreRowForWrite();
  await db.storeSetting.update({ where: { id: "main" }, data });
  return getMenuHeroSettings();
}

/* ================= AGSI SMART VIDEO PROMO BANNER ================= */

export const VIDEO_PROMO_MAX_SLIDES = 3;

/** Batas ukuran video per slide (bytes) — file MP4 di atas ini ditolak. */
export const VIDEO_PROMO_MAX_BYTES = 30 * 1024 * 1024; // 30 MB

/** Jenis tautan slide video: tanpa tautan / buka produk / buka promo. */
export type VideoPromoLinkType = "none" | "product" | "promo";

/** Konfigurasi 1 slide video (tanpa bytes — bytes video disimpan per slot). */
export type VideoPromoSlideConfig = {
  slot: number; // 1..VIDEO_PROMO_MAX_SLIDES
  enabled: boolean;
  /** caption singkat di atas video (opsional) */
  title: string;
  linkType: VideoPromoLinkType;
  /** id produk tujuan bila linkType "product" (null/"" = tanpa produk) */
  productId: string | null;
};

/** Setelan AGSI Smart Video Promo Banner (publik — tanpa bytes video). */
export type VideoPromoSettings = {
  enabled: boolean;
  /** ISO timestamp konten terakhir diubah — cache-buster URL video */
  version: string | null;
  /** SELALU tepat 3 entri (slot 1..3) */
  slides: Array<VideoPromoSlideConfig & { hasVideo: boolean; mime: string | null }>;
};

const DEFAULT_VIDEO_PROMO_SLIDES: VideoPromoSlideConfig[] = [1, 2, 3].map((slot) => ({
  slot,
  enabled: true,
  title: "",
  linkType: "none" as VideoPromoLinkType,
  productId: null,
}));

/** Normalisasi 1 entri konfigurasi slide dari JSON DB → bentuk aman. */
function normalizeVideoSlide(raw: unknown, slot: number): VideoPromoSlideConfig {
  const r = (raw ?? {}) as Partial<VideoPromoSlideConfig>;
  return {
    slot,
    enabled: r.enabled !== false,
    title: typeof r.title === "string" ? r.title.trim().slice(0, 60) : "",
    linkType:
      r.linkType === "product" || r.linkType === "promo" ? r.linkType : "none",
    productId: typeof r.productId === "string" && r.productId.trim() ? r.productId.trim() : null,
  };
}

/** Baca kolom JSON videoPromoSlides → selalu tepat 3 konfigurasi valid. */
function readVideoPromoSlides(raw: unknown): VideoPromoSlideConfig[] {
  const arr = Array.isArray(raw) ? raw : [];
  return [1, 2, 3].map((slot) => normalizeVideoSlide(arr[slot - 1], slot));
}

/** Ambil setelan video promo (publik — tanpa bytes video). */
export async function getVideoPromoSettings(): Promise<VideoPromoSettings> {
  const row = await readStoreSettingsRow();
  const slides = readVideoPromoSlides(row.videoPromoSlides);
  return {
    enabled: row.videoPromoEnabled,
    version: row.videoPromoUpdatedAt ? row.videoPromoUpdatedAt.toISOString() : null,
    slides: slides.map((c) => ({
      ...c,
      // Data saja sudah cukup — mime tak wajib (baris lama, lihat serve-image.ts)
      hasVideo: !!(
        c.slot === 1
          ? row.videoPromoSlot1Data
          : c.slot === 2
            ? row.videoPromoSlot2Data
            : row.videoPromoSlot3Data
      ),
      mime:
        c.slot === 1
          ? row.videoPromoSlot1Mime
          : c.slot === 2
            ? row.videoPromoSlot2Mime
            : row.videoPromoSlot3Mime,
    })),
  };
}

export type VideoPromoPatch = {
  enabled?: boolean;
  slides?: VideoPromoSlideConfig[];
  /** konten berubah → naikkan versi (cache-buster URL video) */
  touch?: boolean;
};

/** Simpan sebagian setelan video promo (metadata saja — bytes via route upload). */
export async function updateVideoPromoSettings(patch: VideoPromoPatch): Promise<VideoPromoSettings> {
  const data: {
    videoPromoEnabled?: boolean;
    videoPromoSlides?: VideoPromoSlideConfig[];
    videoPromoUpdatedAt?: Date;
  } = {};
  if (typeof patch.enabled === "boolean") data.videoPromoEnabled = patch.enabled;
  if (patch.slides) {
    // simpan tepat 3 slide; productId null → "" agar JSON murni string (portabel)
    data.videoPromoSlides = readVideoPromoSlides(
      patch.slides.slice(0, VIDEO_PROMO_MAX_SLIDES).map((s) => ({ ...s, productId: s.productId ?? "" }))
    ).map((s) => ({ ...s, productId: s.productId ?? "" }));
  }
  if (patch.touch) data.videoPromoUpdatedAt = new Date();

  await ensureStoreRowForWrite();
  await db.storeSetting.update({ where: { id: "main" }, data });
  return getVideoPromoSettings();
}

/** Bytes + mime video 1 slot (dipakai route streaming & upload). */
export type VideoPromoSlotBytes = { data: string | null; mime: string | null };

/** Baca bytes video slot (dipakai route streaming & upload chunked). */
export async function getVideoPromoSlotBytes(slot: number): Promise<VideoPromoSlotBytes> {
  const row = await db.storeSetting.findUnique({
    where: { id: "main" },
    select: {
      videoPromoSlot1Data: true,
      videoPromoSlot1Mime: true,
      videoPromoSlot2Data: true,
      videoPromoSlot2Mime: true,
      videoPromoSlot3Data: true,
      videoPromoSlot3Mime: true,
    },
  });
  if (!row) return { data: null, mime: null };
  return {
    data:
      slot === 1
        ? row.videoPromoSlot1Data
        : slot === 2
          ? row.videoPromoSlot2Data
          : row.videoPromoSlot3Data,
    mime:
      slot === 1
        ? row.videoPromoSlot1Mime
        : slot === 2
          ? row.videoPromoSlot2Mime
          : row.videoPromoSlot3Mime,
  };
}

/** Tulis bytes+mime video slot sekaligus (null = hapus) + naikkan versi. */
export async function writeVideoPromoSlotBytes(
  slot: number,
  data: string | null,
  mime: string | null
): Promise<void> {
  await ensureStoreRowForWrite();
  if (slot === 1) {
    await db.storeSetting.update({
      where: { id: "main" },
      data: { videoPromoSlot1Data: data, videoPromoSlot1Mime: mime, videoPromoUpdatedAt: new Date() },
    });
  } else if (slot === 2) {
    await db.storeSetting.update({
      where: { id: "main" },
      data: { videoPromoSlot2Data: data, videoPromoSlot2Mime: mime, videoPromoUpdatedAt: new Date() },
    });
  } else {
    await db.storeSetting.update({
      where: { id: "main" },
      data: { videoPromoSlot3Data: data, videoPromoSlot3Mime: mime, videoPromoUpdatedAt: new Date() },
    });
  }
}

/* ================= ANIMASI KURIR + TIPOGRAFI KINETIK DI BERANDA ================= */

/** Pilihan font teks spanduk animasi (stack CSS aman di semua perangkat). */
export const COURIER_ANIM_FONTS = ["default", "serif", "mono", "system"] as const;
export type CourierAnimFont = (typeof COURIER_ANIM_FONTS)[number];

/** Pilihan ketebalan huruf spanduk. */
export const COURIER_ANIM_WEIGHTS = ["bold", "extrabold", "black"] as const;
export type CourierAnimWeight = (typeof COURIER_ANIM_WEIGHTS)[number];

/** Palet warna teks (kunci → kelas Tailwind di CourierScene — bukan hex bebas,
    agar kombinasi selalu kontras di atas kapsul putih & tetap on-brand). */
export const COURIER_ANIM_COLORS = [
  "orange",
  "red",
  "rose",
  "amber",
  "green",
  "blue",
  "violet",
  "neutral",
] as const;
export type CourierAnimColor = (typeof COURIER_ANIM_COLORS)[number];

/** Batas teks spanduk (karakter) & jumlah kata maksimal (kata ke-N jadi aksen). */
export const COURIER_ANIM_TEXT_MAX = 48;
export const COURIER_ANIM_WORDS_MAX = 5;
/** Rentang ukuran huruf spanduk (px) & durasi siklus adegan (detik). */
export const COURIER_ANIM_FONT_MIN = 8;
export const COURIER_ANIM_FONT_MAX = 12;
export const COURIER_ANIM_CYCLE_MIN = 6;
export const COURIER_ANIM_CYCLE_MAX = 12;

/** Konfigurasi adegan animasi kurir di Beranda (kolom JSON courierAnim). */
export type CourierAnimConfig = {
  /** tampilkan adegan motor kurir + spanduk di Beranda */
  enabled: boolean;
  /** teks spanduk — dipotong per kata, kata TERAKHIR diberi warna aksen */
  text: string;
  /** font teks (default = font aplikasi) */
  font: CourierAnimFont;
  /** ketebalan huruf */
  weight: CourierAnimWeight;
  /** gaya huruf: semua KAPITAL */
  caps: boolean;
  /** gaya huruf: miring */
  italic: boolean;
  /** ukuran huruf (px) */
  fontSize: number;
  /** warna kata biasa */
  textColor: CourierAnimColor;
  /** warna kata terakhir (aksen) */
  accentColor: CourierAnimColor;
  /** durasi satu siklus adegan (detik, 6–12) — makin kecil makin cepat */
  cycleSec: number;
  /** tampilkan ledakan BOOM! 🎉 + konfeti di tengah siklus */
  boom: boolean;
};

/** Nilai bawaan — persis tampilan adegan sebelum fitur setting ada. */
export const DEFAULT_COURIER_ANIM: CourierAnimConfig = {
  enabled: true,
  text: "Ayam Geprek Sambal Ijo",
  font: "default",
  weight: "black",
  caps: true,
  italic: false,
  fontSize: 10,
  textColor: "orange",
  accentColor: "green",
  cycleSec: 8,
  boom: true,
};

/** Jepit angka ke rentang valid (fallback bila bukan angka). */
function clampNum(v: unknown, min: number, max: number, def: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

/** Normalisasi konfigurasi mentah dari JSON DB / payload admin → bentuk aman. */
export function normalizeCourierAnimConfig(raw: unknown): CourierAnimConfig {
  const r = (raw ?? {}) as Partial<CourierAnimConfig>;
  const text = typeof r.text === "string" ? r.text.trim().slice(0, COURIER_ANIM_TEXT_MAX) : "";
  return {
    enabled: r.enabled !== false,
    text: text || DEFAULT_COURIER_ANIM.text,
    font: (COURIER_ANIM_FONTS as readonly string[]).includes(r.font ?? "")
      ? (r.font as CourierAnimFont)
      : DEFAULT_COURIER_ANIM.font,
    weight: (COURIER_ANIM_WEIGHTS as readonly string[]).includes(r.weight ?? "")
      ? (r.weight as CourierAnimWeight)
      : DEFAULT_COURIER_ANIM.weight,
    caps: r.caps !== false,
    italic: r.italic === true,
    fontSize: clampNum(r.fontSize, COURIER_ANIM_FONT_MIN, COURIER_ANIM_FONT_MAX, DEFAULT_COURIER_ANIM.fontSize),
    textColor: (COURIER_ANIM_COLORS as readonly string[]).includes(r.textColor ?? "")
      ? (r.textColor as CourierAnimColor)
      : DEFAULT_COURIER_ANIM.textColor,
    accentColor: (COURIER_ANIM_COLORS as readonly string[]).includes(r.accentColor ?? "")
      ? (r.accentColor as CourierAnimColor)
      : DEFAULT_COURIER_ANIM.accentColor,
    cycleSec: clampNum(r.cycleSec, COURIER_ANIM_CYCLE_MIN, COURIER_ANIM_CYCLE_MAX, DEFAULT_COURIER_ANIM.cycleSec),
    boom: r.boom !== false,
  };
}

/** Ambil setelan animasi kurir (publik — kecil, aman ikut snapshot). */
export async function getCourierAnimSettings(): Promise<CourierAnimConfig> {
  const row = await readStoreSettingsRow();
  return normalizeCourierAnimConfig(row.courierAnim);
}

export type CourierAnimPatch = Partial<CourierAnimConfig>;

/** Simpan sebagian setelan animasi kurir (merge atas konfigurasi tersimpan). */
export async function updateCourierAnimSettings(patch: CourierAnimPatch): Promise<CourierAnimConfig> {
  const existing = await readStoreSettingsRow();
  const next = normalizeCourierAnimConfig({ ...normalizeCourierAnimConfig(existing.courierAnim), ...patch });
  await ensureStoreRowForWrite();
  await db.storeSetting.update({ where: { id: "main" }, data: { courierAnim: next } });
  return next;
}

/* ================= SNAPSHOT SEMUA SETELAN — 1 QUERY ================= */

/** Gabungan semua setelan publik (dipakai GET /api/settings — 1 query DB). */
export type StoreSettingsSnapshot = {
  settings: StoreSettings;
  banner: BannerSettings;
  promo: PromoStripSettings;
  menuHero: MenuHeroSettings;
  menuPromo: MenuPromoSettings;
  videoPromo: VideoPromoSettings;
  courierAnim: CourierAnimConfig;
};

/**
 * Ambil SEMUA setelan sekaligus dari SATU pembacaan baris (read-only).
 *
 * Dulu GET /api/settings menjalankan 6 upsert paralel (satu per bagian) ke
 * baris yang sama — di Prisma Postgres operasi tulis itu saling menunggu
 * hingga timeout pool ±10 detik dan respons selalu jatuh ke fallback
 * (bannerEnabled=false, semua hasImage=false) sehingga banner & promo yang
 * tersimpan tidak pernah muncul. Kini: 1 query findUnique murni, cepat dan
 * tanpa kunci tulis.
 */
export async function getStoreSettingsSnapshot(): Promise<StoreSettingsSnapshot> {
  // Meta ringan (tanpa bytes media ±9 MB) — dulu findUnique seluruh baris
  // membuat /api/settings mengirim ±9 MB dari DB per request (±6 dtk).
  const row = await readStoreSettingsMetaRow();
  const banners = readMenuPromoBanners(row.menuPromoBanners);
  const slides = readVideoPromoSlides(row.videoPromoSlides);
  return {
    settings: {
      deliveryEnabled: row.deliveryEnabled,
      qrisEnabled: row.qrisEnabled,
      ewalletEnabled: row.ewalletEnabled,
    },
    banner: {
      bannerEnabled: row.bannerEnabled,
      bannerTitle: row.bannerTitle,
      bannerText: row.bannerText,
      // Ada gambar = cukup DATA saja — mime tak wajib (lihat serve-image.ts)
      bannerHasImage: !!row.bannerImageData,
      bannerVersion: row.bannerUpdatedAt ? row.bannerUpdatedAt.toISOString() : null,
    },
    promo: {
      promoStripEnabled: row.promoStripEnabled,
      promoStripBadge: row.promoStripBadge,
      promoStripTitle: row.promoStripTitle,
      promoStripText: row.promoStripText,
    },
    menuHero: {
      menuHeroEnabled: row.menuHeroEnabled,
      menuHeroBadge: row.menuHeroBadge,
      menuHeroTitle: row.menuHeroTitle,
      menuHeroText: row.menuHeroText,
      menuHeroHasImage: !!row.menuHeroImageData,
      menuHeroVersion: row.menuHeroUpdatedAt ? row.menuHeroUpdatedAt.toISOString() : null,
    },
    menuPromo: {
      menuPromoVouchersEnabled: row.menuPromoVouchersEnabled,
      menuPromoVouchersMax: row.menuPromoVouchersMax,
      banners: banners.map((c, i) => ({
        ...c,
        slot: (i + 1) as 1 | 2,
        hasImage: !!(i === 0 ? row.menuPromoBanner1ImageData : row.menuPromoBanner2ImageData),
      })),
      version: row.menuPromoBannersUpdatedAt ? row.menuPromoBannersUpdatedAt.toISOString() : null,
    },
    videoPromo: {
      enabled: row.videoPromoEnabled,
      version: row.videoPromoUpdatedAt ? row.videoPromoUpdatedAt.toISOString() : null,
      slides: slides.map((c) => ({
        ...c,
        hasVideo: !!(
          c.slot === 1
            ? row.videoPromoSlot1Data
            : c.slot === 2
              ? row.videoPromoSlot2Data
              : row.videoPromoSlot3Data
        ),
        mime:
          c.slot === 1
            ? row.videoPromoSlot1Mime
            : c.slot === 2
              ? row.videoPromoSlot2Mime
              : row.videoPromoSlot3Mime,
      })),
    },
    courierAnim: readCourierAnim(row.courierAnim),
  };
}
