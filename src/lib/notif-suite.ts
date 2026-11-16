import { create } from "zustand";
import { useAppStore, useNoticeStore, useUiStore, type NoticeAction, type NoticeType } from "@/lib/store";

/* ================= NOTIFIKASI IN-APP — SUITE 5 GAYA TAMPIL (v1.3.13) =================
 * Suite notifikasi halaman — berlaku di aplikasi Android (WebView) & browser.
 * Saat aplikasi TERBUKA, setiap kabar penting kini bisa tampil dalam lima bentuk:
 *
 *   1. HEADS-UP  — kartu melayang turun dari atas layar, auto-tutup ±6,5 dtk,
 *                  ketuk → langsung buka halaman tujuan (NotifSuite.tsx).
 *   2. BANNER    — strip "N kabar baru" menempel di atas layar sampai kabar
 *                  dibuka / ditutup (NotifSuite.tsx).
 *   3. FLOATING  — gelembung oranye melayang yang bisa DISESER (drag) ke mana
 *                  saja + angka kabar, ketuk → buka halaman (NotifSuite.tsx).
 *   4. POPUP     — modal tengah layar (CenterNotice / useNoticeStore) — hanya
 *                  untuk momen KRITIS (pesanan baru, pembayaran, pesanan siap).
 *   5. TOAST     — pil kecil di bawah layar — kabar ringan & konfirmasi.
 *
 * Router tunggal notifySuite() membagi event ke gaya yang pantas; dipakai
 * NotifWatchers (polling + tick push FCM "agsi-push") dan PushBridge
 * (web push browser via service worker). Saat aplikasi DITUTUP, jalur
 * notifikasi SISTEM (status bar + layar kunci + suara) tetap bekerja —
 * lihat AgsiNotifications.kt.
 */

export type SuiteKind =
  | "new_order"
  | "order_paid"
  | "order_status"
  | "chat"
  | "courier_task"
  | "info";

export type SuiteEvent = {
  kind: SuiteKind;
  title: string;
  body: string;
  /** path tujuan saat kabar diketuk: "/orders" | "/chat" | "/kurir" | "/reports" */
  url: string;
};

export type SuiteItem = SuiteEvent & { id: number };

type NotifSuiteState = {
  /** antrean HEADS-UP (maks 2 — yang terbaru menang) */
  headsUp: SuiteItem[];
  pushHeadsUp: (ev: SuiteEvent) => void;
  dismissHeadsUp: (id: number) => void;

  /** BANNER: jumlah kabar belum dibuka + kabar terakhir (strip atas) */
  bannerCount: number;
  bannerLatest: SuiteEvent | null;
  clearBanner: () => void;

  /** FLOATING BUBBLE: hitungan kabar + tujuan ketukan */
  bubbleCount: number;
  bubbleUrl: string;
  clearBubble: () => void;

  /** antrean TOAST (maks 3) */
  toasts: SuiteItem[];
  pushToast: (ev: SuiteEvent) => void;
  dismissToast: (id: number) => void;
};

let seq = 1;

export const useNotifSuiteStore = create<NotifSuiteState>((set) => ({
  headsUp: [],
  pushHeadsUp: (ev) =>
    set((s) => ({ headsUp: [...s.headsUp.slice(-1), { ...ev, id: seq++ }] })),
  dismissHeadsUp: (id) =>
    set((s) => ({ headsUp: s.headsUp.filter((h) => h.id !== id) })),

  bannerCount: 0,
  bannerLatest: null,
  clearBanner: () => set({ bannerCount: 0, bannerLatest: null }),

  bubbleCount: 0,
  bubbleUrl: "/orders",
  clearBubble: () => set({ bubbleCount: 0 }),

  toasts: [],
  pushToast: (ev) =>
    set((s) => ({ toasts: [...s.toasts.slice(-2), { ...ev, id: seq++ }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/**
 * Navigasi ke halaman tujuan kabar — dipakai NotifSuite (tap heads-up /
 * banner / gelembung) dan aksi default popup. Kurir diarahkan ke beranda
 * tugas kurir (tidak punya daftar pesanan), "/chat" membuka overlay chat.
 */
export function navToSuiteUrl(url: string, role?: string) {
  if (url.startsWith("/chat")) {
    useUiStore.getState().openChat();
    return;
  }
  const go = useAppStore.getState().go;
  if (url.startsWith("/orders")) {
    go(role === "COURIER" ? "kurir" : "orders");
    return;
  }
  if (url.startsWith("/kurir") || url.startsWith("/courier")) {
    go("kurir");
    return;
  }
  if (url.startsWith("/reports")) {
    go("reports");
  }
}

/**
 * SATU PINTU suite notifikasi in-app (v1.3.13). Panggil untuk SETIAP kabar
 * penting; pembagian gaya:
 *  - "critical" → HEADS-UP + BANNER + FLOATING + POPUP tengah (momen besar)
 *  - "important" → HEADS-UP + BANNER + FLOATING (pembaruan biasa)
 *  - "minor" → TOAST saja (kabar ringan / konfirmasi)
 */
export function notifySuite(
  ev: SuiteEvent,
  level: "critical" | "important" | "minor" = "important",
  popup?: {
    type: NoticeType;
    mascot?: boolean;
    title?: string;
    message?: string;
    actions?: NoticeAction[];
  },
) {
  const s = useNotifSuiteStore.getState();
  if (level === "minor") {
    s.pushToast(ev);
    return;
  }
  s.pushHeadsUp(ev);
  useNotifSuiteStore.setState({
    bannerCount: s.bannerCount + 1,
    bannerLatest: ev,
    bubbleCount: s.bubbleCount + 1,
    bubbleUrl: ev.url,
  });
  if (level === "critical") {
    useNoticeStore.getState().show({
      type: popup?.type ?? "info",
      mascot: popup?.mascot,
      autoCloseMs: 9000,
      title: popup?.title ?? ev.title,
      message: popup?.message ?? ev.body,
      actions:
        popup?.actions ??
        [
          {
            label: "Buka Sekarang",
            onClick: () => navToSuiteUrl(ev.url),
          },
          { label: "Nanti" },
        ],
    });
  }
}
