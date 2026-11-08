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
