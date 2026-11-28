"use client";

import { create } from "zustand";
import { apiFetch } from "@/lib/api";
import { motionPublicOf, normalizeMotionPublic, defaultMotionDoc, type MotionPublic } from "@/lib/motion-config";
import type { OrderData, Product, VoucherAdminInfo, VoucherInfo } from "@/lib/types";

/* ================= PRODUK (cache global) ================= */

type ProductsState = {
  products: Product[];
  loading: boolean;
  loaded: boolean;
  load: (force?: boolean) => Promise<void>;
};

export const useProductsStore = create<ProductsState>((set, get) => ({
  products: [],
  loading: false,
  loaded: false,
  load: async (force = false) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true });
    try {
      const res = await apiFetch("/api/products");
      const data = await res.json();
      set({ products: (data.products ?? []) as Product[], loaded: true });
    } catch {
      // biarkan data lama / kosong
    } finally {
      set({ loading: false });
    }
  },
}));

/* ================= PESANAN ================= */

type OrdersState = {
  orders: OrderData[];
  loading: boolean;
  loaded: boolean;
  load: (scope: "mine" | "all", force?: boolean) => Promise<void>;
};

export const useOrdersStore = create<OrdersState>((set, get) => ({
  orders: [],
  loading: false,
  loaded: false,
  load: async (scope, force = false) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true });
    try {
      const res = await apiFetch(`/api/orders?scope=${scope}`);
      if (res.ok) {
        const data = await res.json();
        set({ orders: (data.orders ?? []) as OrderData[], loaded: true });
      }
    } catch {
      // diam
    } finally {
      set({ loading: false });
    }
  },
}));

export async function refreshOrders(scope: "mine" | "all") {
  await useOrdersStore.getState().load(scope, true);
}

export async function refreshProducts() {
  await useProductsStore.getState().load(true);
}

/** Hitung pesanan aktif (belum selesai/batal) untuk badge navigasi */
export function countPending(orders: OrderData[]): number {
  return orders.filter((o) => ["PENDING", "PREPARING", "READY"].includes(o.status)).length;
}

/* ================= VOUCHER (halaman pelanggan) ================= */

type VouchersState = {
  vouchers: VoucherInfo[];
  loading: boolean;
  loaded: boolean;
  load: (force?: boolean) => Promise<void>;
  /** kode voucher yang "dibawa" dari halaman lain ke keranjang (otomatis terisi) */
  pendingCode: string | null;
  setPendingCode: (code: string | null) => void;
};

export const useVouchersStore = create<VouchersState>()((set, get) => ({
  vouchers: [],
  loading: false,
  loaded: false,
  pendingCode: null,
  setPendingCode: (code) => set({ pendingCode: code }),
  load: async (force = false) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true });
    try {
      const res = await apiFetch("/api/vouchers");
      if (res.ok) {
        const data = await res.json();
        set({ vouchers: (data.vouchers ?? []) as VoucherInfo[], loaded: true });
      }
    } catch {
      // biarkan data lama / kosong
    } finally {
      set({ loading: false });
    }
  },
}));

export async function refreshVouchers() {
  await useVouchersStore.getState().load(true);
}

/** Muat daftar voucher pelanggan setelah login/cek sesi (status "sudah dipakai" per akun) */
export function loadVouchersFor(user: { role: string } | null | undefined) {
  if (!user) return;
  // dipakai ulang tiap login agar penanda "sudah dipakai akun ini" selalu segar
  void useVouchersStore.getState().load(true);
}

/* ================= PENGATURAN TOKO (saklar antar & QRIS) ================= */

/**
 * Saklar layanan toko yang dikendalikan admin (Profil Admin → Pengaturan Toko),
 * plus konten popup banner beranda (Profil Admin → Popup Banner Beranda).
 * Dimuat global saat aplikasi dibuka; pelanggan & POS memakainya untuk
 * MENYEMBUNYIKAN opsi antar pesanan / pembayaran QRIS yang dinonaktifkan,
 * dan Beranda memakainya untuk menampilkan popup banner.
 * Default aman sampai data server terambil (tidak flicker).
 */
export type BannerInfo = {
  bannerEnabled: boolean;
  bannerTitle: string | null;
  bannerText: string | null;
  bannerHasImage: boolean;
  /** ISO timestamp konten banner terakhir diubah — kunci "sudah tampil" sesi */
  bannerVersion: string | null;
  /** URL gambar banner (cache-busted) — null bila nonaktif / belum ada gambar */
  bannerImageUrl: string | null;
};

/**
 * Konten strip "Promo Hari Ini" di Beranda (Profil Admin → Banner & Promo).
 * String kosong pada salah satu baris = baris itu disembunyikan di Beranda.
 */
export type PromoStripInfo = {
  promoStripEnabled: boolean;
  promoStripBadge: string;
  promoStripTitle: string;
  promoStripText: string;
};

/**
 * Konten hero banner promo di halaman Menu (Profil Admin → Banner & Promo).
 * String kosong pada salah satu baris = baris itu disembunyikan di Menu.
 */
export type MenuHeroInfo = {
  menuHeroEnabled: boolean;
  menuHeroBadge: string;
  menuHeroTitle: string;
  menuHeroText: string;
  menuHeroHasImage: boolean;
  /** ISO timestamp konten hero terakhir diubah — cache-buster URL gambar */
  menuHeroVersion: string | null;
  /** URL gambar latar hero (cache-busted) — null bila nonaktif / belum ada gambar */
  menuHeroImageUrl: string | null;
};

/**
 * Tema warna gradien latar banner promo (tanpa gambar).
 * Konsisten dengan MENU_PROMO_BANNER_THEMES di lib/store-settings (server).
 */
export type MenuPromoBannerTheme = "orange" | "rose" | "emerald" | "blue" | "violet";

/** Konfigurasi 1 banner promo custom di carousel Menu (slot 1 & 2). */
export type MenuPromoBannerInfo = {
  slot: number; // 1 | 2
  enabled: boolean;
  badge: string;
  title: string;
  text: string;
  emoji: string;
  theme: MenuPromoBannerTheme;
  hasImage: boolean;
  /** URL gambar latar banner (cache-busted) — null bila nonaktif / belum ada gambar */
  imageUrl: string | null;
};

/**
 * Setelan carousel promo halaman Menu
 * (Profil Admin → Banner & Promo): slide voucher + 2 banner promo custom.
 */
export type MenuPromoInfo = {
  /** tampilkan slide voucher aktif di carousel Menu */
  menuPromoVouchersEnabled: boolean;
  /** jumlah maksimal slide voucher (1–5) */
  menuPromoVouchersMax: number;
  /** konfigurasi 2 banner promo custom — selalu tepat 2 entri (slot 1 & 2) */
  banners: MenuPromoBannerInfo[];
  /** ISO timestamp konten banner promo terakhir diubah — cache-buster URL gambar */
  version: string | null;
};

/**
 * AGSI Smart Video Promo Banner (alias Interactive Video Carousel Banner) —
 * carousel video MP4 di dasar halaman Menu (Profil Admin → Banner & Promo):
 * autoplay, loop, bisa digeser seperti carousel, klik untuk membuka produk
 * atau promo. Bytes video tidak ikut payload — dimuat terpisah via videoUrl.
 */
export type VideoPromoSlideInfo = {
  slot: number; // 1..3
  enabled: boolean;
  title: string;
  linkType: "none" | "product" | "promo";
  productId: string | null;
  hasVideo: boolean;
  /** URL video MP4 (cache-busted) — null bila nonaktif / belum ada video */
  videoUrl: string | null;
};

export type VideoPromoInfo = {
  enabled: boolean;
  /** ISO timestamp konten terakhir diubah — cache-buster URL video */
  version: string | null;
  /** SELALU tepat 3 entri (slot 1..3) */
  slides: VideoPromoSlideInfo[];
};

/* ================= ANIMASI KURIR + TIPOGRAFI KINETIK DI BERANDA ================= */

/**
 * Adegan animasi kurir + spanduk teks di Beranda
 * (Profil Admin → "Animasi Beranda"): saklar aktif, teks spanduk, font,
 * gaya/ketebalan huruf, warna teks & aksen, ukuran, kecepatan siklus, BOOM.
 * Nilai bawaan = tampilan sebelum fitur setting ada. Server juga menormalisasi
 * (store-settings.ts) — duplikasi kecil di sini sebagai tameng payload rusak.
 */
export const COURIER_ANIM_FONTS = ["default", "serif", "mono", "system"] as const;
export const COURIER_ANIM_WEIGHTS = ["bold", "extrabold", "black"] as const;
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

/** Preset gaya animasi spanduk 3D (Profil Admin → "Animasi Beranda") —
    klasik = wipe teks semula; sisanya varian transformasi 3D (perspektif CSS). */
export const COURIER_ANIM_STYLES = ["klasik", "flip3d", "carousel3d", "zoom3d", "swing3d"] as const;

export type CourierAnimInfo = {
  enabled: boolean;
  /** teks spanduk — dipotong per kata, kata TERAKHIR diberi warna aksen */
  text: string;
  font: (typeof COURIER_ANIM_FONTS)[number];
  weight: (typeof COURIER_ANIM_WEIGHTS)[number];
  caps: boolean;
  italic: boolean;
  fontSize: number;
  textColor: (typeof COURIER_ANIM_COLORS)[number];
  accentColor: (typeof COURIER_ANIM_COLORS)[number];
  /** preset gaya animasi spanduk (emoji = model baru tanpa animasi + 🔥⛵️🎃;
      klasik = wipe; sisanya varian 3D) */
  animStyle: (typeof COURIER_ANIM_STYLES)[number];
  /** durasi satu siklus adegan (detik, 6–12) — makin kecil makin cepat */
  cycleSec: number;
  boom: boolean;
};

const FALLBACK_COURIER_ANIM: CourierAnimInfo = {
  enabled: true,
  text: "Ayam Geprek Sambal Ijo",
  font: "default",
  weight: "black",
  caps: true,
  italic: false,
  fontSize: 10,
  textColor: "orange",
  accentColor: "green",
  animStyle: "emoji",
  cycleSec: 8,
  boom: true,
};

function normalizeCourierAnim(raw: unknown): CourierAnimInfo {
  const r = (raw ?? {}) as Partial<CourierAnimInfo>;
  const text = typeof r.text === "string" ? r.text.trim().slice(0, 48) : "";
  const num = (v: unknown, min: number, max: number, def: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  return {
    enabled: r.enabled !== false,
    text: text || FALLBACK_COURIER_ANIM.text,
    font: (COURIER_ANIM_FONTS as readonly string[]).includes(r.font ?? "")
      ? (r.font as CourierAnimInfo["font"])
      : "default",
    weight: (COURIER_ANIM_WEIGHTS as readonly string[]).includes(r.weight ?? "")
      ? (r.weight as CourierAnimInfo["weight"])
      : "black",
    caps: r.caps !== false,
    italic: r.italic === true,
    fontSize: num(r.fontSize, 8, 12, 10),
    textColor: (COURIER_ANIM_COLORS as readonly string[]).includes(r.textColor ?? "")
      ? (r.textColor as CourierAnimInfo["textColor"])
      : "orange",
    accentColor: (COURIER_ANIM_COLORS as readonly string[]).includes(r.accentColor ?? "")
      ? (r.accentColor as CourierAnimInfo["accentColor"])
      : "green",
    animStyle: (COURIER_ANIM_STYLES as readonly string[]).includes(r.animStyle ?? "")
      ? (r.animStyle as CourierAnimInfo["animStyle"])
      : "emoji",
    cycleSec: num(r.cycleSec, 6, 12, 8),
    boom: r.boom !== false,
  };
}

type SettingsState = {
  deliveryEnabled: boolean;
  qrisEnabled: boolean;
  ewalletEnabled: boolean;
  banner: BannerInfo;
  promo: PromoStripInfo;
  menuHero: MenuHeroInfo;
  menuPromo: MenuPromoInfo;
  videoPromo: VideoPromoInfo;
  courierAnim: CourierAnimInfo;
  /** AGSI Motion Studio — konfigurasi animasi AKTIF (published) */
  motion: MotionPublic;
  loaded: boolean;
  loading: boolean;
  load: (force?: boolean) => Promise<void>;
};

const FALLBACK_BANNER: BannerInfo = {
  bannerEnabled: false,
  bannerTitle: null,
  bannerText: null,
  bannerHasImage: false,
  bannerVersion: null,
  bannerImageUrl: null,
};

/** Nilai awal strip promo — sama dengan default schema/DB, agar Beranda tak pernah kosong sebelum data terambil. */
const FALLBACK_PROMO: PromoStripInfo = {
  promoStripEnabled: true,
  promoStripBadge: "Promo Hari Ini",
  promoStripTitle: "Paket Komplit mulai Rp 27.000",
  promoStripText: "Geprek + nasi + es teh manis jumbo",
};

/** Nilai awal hero banner menu — sama dengan default schema/DB. */
const FALLBACK_MENU_HERO: MenuHeroInfo = {
  menuHeroEnabled: true,
  menuHeroBadge: "Promo Spesial",
  menuHeroTitle: "Paket Komplit mulai Rp 27.000",
  menuHeroText: "Geprek + nasi + es teh manis jumbo",
  menuHeroHasImage: false,
  menuHeroVersion: null,
  menuHeroImageUrl: null,
};

/** Nilai awal setelan carousel promo menu — sama dengan default schema/DB. */
const FALLBACK_MENU_PROMO_BANNERS: MenuPromoBannerInfo[] = [
  { slot: 1, enabled: true, badge: "Promo Spesial", title: "Beli 2 Gratis 1 Es Teh", text: "Berlaku setiap hari kerja di outlet AGSI", emoji: "🥤", theme: "violet", hasImage: false, imageUrl: null },
  { slot: 2, enabled: true, badge: "Menu Baru", title: "Ayam Geprik Sambal Bawang", text: "Pedas nampol, harga hemat mulai Rp 15.000", emoji: "🌶️", theme: "emerald", hasImage: false, imageUrl: null },
];
const FALLBACK_MENU_PROMO: MenuPromoInfo = {
  menuPromoVouchersEnabled: true,
  menuPromoVouchersMax: 3,
  banners: FALLBACK_MENU_PROMO_BANNERS,
  version: null,
};

/** Nilai awal AGSI Smart Video Promo Banner — sama dengan default schema/DB. */
const FALLBACK_VIDEO_PROMO_SLIDES: VideoPromoSlideInfo[] = [1, 2, 3].map((slot) => ({
  slot,
  enabled: true,
  title: "",
  linkType: "none" as const,
  productId: null,
  hasVideo: false,
  videoUrl: null,
}));
const FALLBACK_VIDEO_PROMO: VideoPromoInfo = {
  enabled: false,
  version: null,
  slides: FALLBACK_VIDEO_PROMO_SLIDES,
};

function normalizePromo(raw: unknown): PromoStripInfo {
  const p = (raw ?? {}) as Partial<PromoStripInfo>;
  return {
    promoStripEnabled: p.promoStripEnabled !== false,
    promoStripBadge: typeof p.promoStripBadge === "string" ? p.promoStripBadge : FALLBACK_PROMO.promoStripBadge,
    promoStripTitle: typeof p.promoStripTitle === "string" ? p.promoStripTitle : FALLBACK_PROMO.promoStripTitle,
    promoStripText: typeof p.promoStripText === "string" ? p.promoStripText : FALLBACK_PROMO.promoStripText,
  };
}

function normalizeBanner(raw: unknown): BannerInfo {
  const b = (raw ?? {}) as Partial<BannerInfo> & { bannerVersion?: string | null };
  const hasImage = b.bannerHasImage === true;
  const enabled = b.bannerEnabled === true;
  return {
    bannerEnabled: enabled,
    bannerTitle: b.bannerTitle ?? null,
    bannerText: b.bannerText ?? null,
    bannerHasImage: hasImage,
    bannerVersion: b.bannerVersion ?? null,
    bannerImageUrl:
      enabled && hasImage
        ? `/api/settings/banner/image?v=${encodeURIComponent(b.bannerVersion ?? "1")}`
        : null,
  };
}

function normalizeMenuHero(raw: unknown): MenuHeroInfo {
  const h = (raw ?? {}) as Partial<MenuHeroInfo>;
  const hasImage = h.menuHeroHasImage === true;
  const enabled = h.menuHeroEnabled !== false;
  return {
    menuHeroEnabled: enabled,
    menuHeroBadge: typeof h.menuHeroBadge === "string" ? h.menuHeroBadge : FALLBACK_MENU_HERO.menuHeroBadge,
    menuHeroTitle: typeof h.menuHeroTitle === "string" ? h.menuHeroTitle : FALLBACK_MENU_HERO.menuHeroTitle,
    menuHeroText: typeof h.menuHeroText === "string" ? h.menuHeroText : FALLBACK_MENU_HERO.menuHeroText,
    menuHeroHasImage: hasImage,
    menuHeroVersion: h.menuHeroVersion ?? null,
    menuHeroImageUrl:
      enabled && hasImage
        ? `/api/settings/menu-hero/image?v=${encodeURIComponent(h.menuHeroVersion ?? "1")}`
        : null,
  };
}

const MENU_PROMO_THEME_VALUES: MenuPromoBannerTheme[] = ["orange", "rose", "emerald", "blue", "violet"];

function normalizeMenuPromo(raw: unknown): MenuPromoInfo {
  const m = (raw ?? {}) as Partial<MenuPromoInfo>;
  const max = Number(m.menuPromoVouchersMax);
  const version = typeof m.version === "string" ? m.version : null;
  const rawBanners = Array.isArray(m.banners) ? m.banners : [];
  const banners: MenuPromoBannerInfo[] = [0, 1].map((i) => {
    const def = FALLBACK_MENU_PROMO_BANNERS[i];
    const r = (rawBanners[i] ?? {}) as Partial<MenuPromoBannerInfo>;
    const enabled = r.enabled !== false;
    const hasImage = r.hasImage === true;
    const theme: MenuPromoBannerTheme = MENU_PROMO_THEME_VALUES.includes(r.theme as MenuPromoBannerTheme)
      ? (r.theme as MenuPromoBannerTheme)
      : def.theme;
    return {
      slot: i + 1,
      enabled,
      badge: typeof r.badge === "string" ? r.badge : def.badge,
      title: typeof r.title === "string" ? r.title : def.title,
      text: typeof r.text === "string" ? r.text : def.text,
      emoji: typeof r.emoji === "string" && r.emoji.trim() ? r.emoji : def.emoji,
      theme,
      hasImage,
      imageUrl:
        enabled && hasImage
          ? `/api/settings/menu-promo/image?slot=${i + 1}&v=${encodeURIComponent(version ?? "1")}`
          : null,
    };
  });
  return {
    menuPromoVouchersEnabled: m.menuPromoVouchersEnabled !== false,
    menuPromoVouchersMax:
      Number.isFinite(max) && max >= 1 && max <= 5 ? Math.round(max) : FALLBACK_MENU_PROMO.menuPromoVouchersMax,
    banners,
    version,
  };
}

function normalizeVideoPromo(raw: unknown): VideoPromoInfo {
  const v = (raw ?? {}) as Partial<VideoPromoInfo>;
  const version = typeof v.version === "string" ? v.version : null;
  const rawSlides = Array.isArray(v.slides) ? v.slides : [];
  const slides: VideoPromoSlideInfo[] = [0, 1, 2].map((i) => {
    const r = (rawSlides[i] ?? {}) as Partial<VideoPromoSlideInfo>;
    const enabled = r.enabled !== false;
    const hasVideo = r.hasVideo === true;
    const linkType =
      r.linkType === "product" || r.linkType === "promo" ? r.linkType : "none";
    return {
      slot: i + 1,
      enabled,
      title: typeof r.title === "string" ? r.title : "",
      linkType,
      productId: typeof r.productId === "string" && r.productId ? r.productId : null,
      hasVideo,
      videoUrl: enabled && hasVideo && typeof r.videoUrl === "string" ? r.videoUrl : null,
    };
  });
  return {
    enabled: v.enabled === true,
    version,
    slides,
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  deliveryEnabled: true,
  qrisEnabled: true,
  ewalletEnabled: true,
  banner: FALLBACK_BANNER,
  promo: FALLBACK_PROMO,
  menuHero: FALLBACK_MENU_HERO,
  menuPromo: FALLBACK_MENU_PROMO,
  videoPromo: FALLBACK_VIDEO_PROMO,
  courierAnim: FALLBACK_COURIER_ANIM,
  motion: motionPublicOf(defaultMotionDoc()),
  loaded: false,
  loading: false,
  load: async (force = false) => {
    if (get().loading) return;
    if (get().loaded && !force) return;
    set({ loading: true });
    try {
      const res = await apiFetch("/api/settings", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        set({
          deliveryEnabled: data.deliveryEnabled !== false,
          qrisEnabled: data.qrisEnabled !== false,
          ewalletEnabled: data.ewalletEnabled !== false,
          banner: normalizeBanner(data.banner),
          promo: normalizePromo(data.promo),
          menuHero: normalizeMenuHero(data.menuHero),
          menuPromo: normalizeMenuPromo(data.menuPromo),
          videoPromo: normalizeVideoPromo(data.videoPromo),
          courierAnim: normalizeCourierAnim(data.courierAnim),
          motion: normalizeMotionPublic(data.motion),
          loaded: true,
        });
      }
    } catch {
      // diam — pakai nilai terakhir / default
    } finally {
      set({ loading: false });
    }
  },
}));

export async function refreshSettings() {
  await useSettingsStore.getState().load(true);
}

/* ================= VOUCHER (daftar admin) ================= */

type AdminVouchersState = {
  vouchers: VoucherAdminInfo[];
  loading: boolean;
  load: (force?: boolean) => Promise<void>;
};

export const useAdminVouchersStore = create<AdminVouchersState>()((set, get) => ({
  vouchers: [],
  loading: false,
  load: async (force = false) => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const res = await apiFetch("/api/vouchers?scope=all");
      if (res.ok) {
        const data = await res.json();
        set({ vouchers: (data.vouchers ?? []) as VoucherAdminInfo[] });
      }
    } catch {
      // diam
    } finally {
      set({ loading: false });
    }
  },
}));

export async function refreshAdminVouchers() {
  await useAdminVouchersStore.getState().load(true);
}
