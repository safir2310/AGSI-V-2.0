"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/* ================= KERANJANG ================= */

export type CartItem = {
  productId: string;
  name: string;
  emoji: string;
  price: number;
  qty: number;
  imageColor: string;
};

type CartState = {
  items: CartItem[];
  add: (item: Omit<CartItem, "qty">, qty?: number) => void;
  remove: (productId: string) => void;
  setQty: (productId: string, qty: number) => void;
  clear: () => void;
  totalItems: () => number;
  totalPrice: () => number;
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (item, qty = 1) =>
        set((s) => {
          const existing = s.items.find((i) => i.productId === item.productId);
          if (existing) {
            return {
              items: s.items.map((i) =>
                i.productId === item.productId ? { ...i, qty: i.qty + qty } : i
              ),
            };
          }
          return { items: [...s.items, { ...item, qty }] };
        }),
      remove: (productId) =>
        set((s) => ({ items: s.items.filter((i) => i.productId !== productId) })),
      setQty: (productId, qty) =>
        set((s) => ({
          items:
            qty <= 0
              ? s.items.filter((i) => i.productId !== productId)
              : s.items.map((i) => (i.productId === productId ? { ...i, qty } : i)),
        })),
      clear: () => set({ items: [] }),
      totalItems: () => get().items.reduce((sum, i) => sum + i.qty, 0),
      totalPrice: () => get().items.reduce((sum, i) => sum + i.qty * i.price, 0),
    }),
    { name: "agsi-cart" }
  )
);

/* ================= POPUP NOTIFIKASI TENGAH ================= */
// (lihat useNoticeStore di bawah — mendukung autoCloseMs untuk notifikasi)

export type NoticeType = "success" | "error" | "info" | "confirm";

export type NoticeAction = {
  label: string;
  onClick?: () => void;
  variant?: "default" | "destructive";
};

type NoticeState = {
  open: boolean;
  type: NoticeType;
  title: string;
  message: string;
  mascot?: boolean;
  /** bila > 0, popup menutup sendiri setelah sekian ms (untuk notifikasi masuk) */
  autoCloseMs: number;
  actions: NoticeAction[];
  show: (n: {
    type: NoticeType;
    title: string;
    message: string;
    mascot?: boolean;
    autoCloseMs?: number;
    actions?: NoticeAction[];
  }) => void;
  close: () => void;
};

export const useNoticeStore = create<NoticeState>((set) => ({
  open: false,
  type: "info",
  title: "",
  message: "",
  mascot: false,
  autoCloseMs: 0,
  actions: [],
  show: (n) =>
    set({
      open: true,
      type: n.type,
      title: n.title,
      message: n.message,
      mascot: n.mascot ?? false,
      autoCloseMs: n.autoCloseMs ?? 0,
      actions:
        n.actions ??
        [{ label: "Oke, Mengerti", variant: n.type === "error" ? "destructive" : "default" }],
    }),
  close: () => set({ open: false, actions: [], autoCloseMs: 0 }),
}));

/* ================= UI GLOBAL (chat CS dari mana saja) ================= */

/**
 * Sheet chat CS dipasang GLOBAL di AppShell supaya popup notifikasi
 * ("💬 Pesan baru dari CS") bisa langsung membuka chat dari halaman mana pun.
 * chatUnreadTick naik tiap chat ditutup → badge di halaman profil ikut menyegarkan.
 */
type UiState = {
  chatOpen: boolean;
  /** Bila diisi (admin), sheet chat langsung membuka utas pelanggan ini —
      dipakai tombol 💬 di kartu pesanan halaman admin. */
  chatTargetUserId: string | null;
  openChat: (targetUserId?: string) => void;
  closeChat: () => void;
  chatUnreadTick: number;
};

export const useUiStore = create<UiState>((set) => ({
  chatOpen: false,
  chatTargetUserId: null,
  chatUnreadTick: 0,
  openChat: (targetUserId) =>
    set({ chatOpen: true, chatTargetUserId: targetUserId ?? null }),
  closeChat: () =>
    set((s) => ({
      chatOpen: false,
      chatTargetUserId: null,
      chatUnreadTick: s.chatUnreadTick + 1,
    })),
}));

/* ================= NAVIGASI APLIKASI ================= */

export type CustomerView = "home" | "menu" | "cart" | "orders" | "profile";
export type AdminView = "dashboard" | "products" | "vouchers" | "orders" | "reports" | "profile";
export type AppView = CustomerView | AdminView | "pos" | "auth";

type AppState = {
  view: AppView;
  go: (view: AppView) => void;
};

export const useAppStore = create<AppState>((set) => ({
  view: "auth",
  go: (view) => set({ view }),
}));
