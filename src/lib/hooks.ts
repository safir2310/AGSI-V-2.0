"use client";

import { create } from "zustand";
import { apiFetch } from "@/lib/api";
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
 * Setelan slide voucher di carousel promo halaman Menu
 * (Profil Admin → Banner & Promo → bagian Slide Voucher di Menu).
 */
export type MenuPromoInfo = {
  /** tampilkan slide voucher aktif di carousel Menu */
  menuPromoVouchersEnabled: boolean;
  /** jumlah maksimal slide voucher (1–5) */
  menuPromoVouchersMax: number;
};

type SettingsState = {
  deliveryEnabled: boolean;
  qrisEnabled: boolean;
  banner: BannerInfo;
  promo: PromoStripInfo;
  menuHero: MenuHeroInfo;
  menuPromo: MenuPromoInfo;
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

/** Nilai awal setelan slide voucher carousel menu — sama dengan default schema/DB. */
const FALLBACK_MENU_PROMO: MenuPromoInfo = {
  menuPromoVouchersEnabled: true,
  menuPromoVouchersMax: 3,
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

function normalizeMenuPromo(raw: unknown): MenuPromoInfo {
  const m = (raw ?? {}) as Partial<MenuPromoInfo>;
  const max = Number(m.menuPromoVouchersMax);
  return {
    menuPromoVouchersEnabled: m.menuPromoVouchersEnabled !== false,
    menuPromoVouchersMax:
      Number.isFinite(max) && max >= 1 && max <= 5 ? Math.round(max) : FALLBACK_MENU_PROMO.menuPromoVouchersMax,
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  deliveryEnabled: true,
  qrisEnabled: true,
  banner: FALLBACK_BANNER,
  promo: FALLBACK_PROMO,
  menuHero: FALLBACK_MENU_HERO,
  menuPromo: FALLBACK_MENU_PROMO,
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
          banner: normalizeBanner(data.banner),
          promo: normalizePromo(data.promo),
          menuHero: normalizeMenuHero(data.menuHero),
          menuPromo: normalizeMenuPromo(data.menuPromo),
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
