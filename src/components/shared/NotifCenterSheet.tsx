"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bike,
  Bell,
  ChefHat,
  MessageCircle,
  ShoppingBag,
  Trash2,
  Wallet,
} from "lucide-react";
import { useAppStore, useUiStore } from "@/lib/store";
import {
  CenterEntry,
  clearEntries,
  listEntries,
  markAllRead,
  unreadCount,
} from "@/lib/notif-center";

/**
 * 🗂️ NOTIFICATION CENTER — PUSAT SELURUH NOTIFIKASI (v1.3.10).
 *
 * Sheet bawah yang dibuka dari LONCENG di header: daftar semua notifikasi —
 * kartu sistem saat aplikasi ditutup (pesanan baru, QRIS terbayar, status
 * masakan, chat) maupun kabar real-time saat aplikasi terbuka — di aplikasi
 * Android dibaca dari riwayat native (NotifHistory), di browser dari
 * localStorage. Fitur:
 *  - BADGE belum dibaca (angka di lonceng) otomatis nol setelah dibuka;
 *  - entri belum dibaca disorot;
 *  - tap entri → DEEP LINK ke halaman terkait (pesanan / chat);
 *  - tombol "Kosongkan Riwayat".
 */
export function NotifCenterSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<CenterEntry[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<number>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const go = useAppStore((s) => s.go);

  // Saat sheet dibuka: muat riwayat + tandai semua sudah dibaca (badge nol)
  useEffect(() => {
    if (!open) return;
    const all = listEntries();
    const read = unreadCount(all) > 0;
    const lastRead = Number(localStorage.getItem("agsi_notif_last_read") ?? 0);
    setEntries(all);
    setUnreadIds(new Set(all.filter((e) => e.ts > lastRead).map((e) => e.ts)));
    setConfirmClear(false);
    if (read) markAllRead();
  }, [open]);

  const ordered = useMemo(() => entries.slice().reverse(), [entries]);

  const openEntry = (e: CenterEntry) => {
    onClose();
    if (e.url?.startsWith("/chat")) {
      useUiStore.getState().openChat();
      return;
    }
    if (e.url?.startsWith("/orders")) {
      go("orders");
      return;
    }
    if (e.url?.startsWith("/reports")) {
      go("reports");
      return;
    }
    // tanpa url spesifik → biarkan halaman saat ini
  };

  const clearAll = () => {
    clearEntries();
    setEntries([]);
    setUnreadIds(new Set());
    setConfirmClear(false);
  };

  const roleIcon = (kind: string) => {
    switch (kind) {
      case "new_order":
        return { icon: ShoppingBag, color: "bg-orange-100 text-orange-700" };
      case "order_paid":
        return { icon: Wallet, color: "bg-emerald-100 text-emerald-700" };
      case "order_status":
        return { icon: ChefHat, color: "bg-amber-100 text-amber-700" };
      case "chat":
        return { icon: MessageCircle, color: "bg-sky-100 text-sky-700" };
      case "courier_task":
        return { icon: Bike, color: "bg-violet-100 text-violet-700" };
      default:
        return { icon: Bell, color: "bg-neutral-100 text-neutral-600" };
    }
  };

  const timeLabel = (ts: number) => {
    try {
      return new Intl.DateTimeFormat("id-ID", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(ts));
    } catch {
      return "";
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
            className="relative z-10 flex max-h-[82dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl"
          >
            {/* Kepala sheet */}
            <div className="flex items-center justify-between border-b border-orange-100 px-5 pb-3 pt-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-100">
                  <Bell className="h-4 w-4 text-orange-700" />
                </span>
                <div className="leading-tight">
                  <p className="text-sm font-black uppercase tracking-wide text-neutral-900">
                    Pusat Notifikasi
                  </p>
                  <p className="text-[10px] font-semibold text-neutral-500">
                    Semua kabar pesanan, pembayaran &amp; chat
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Tutup pusat notifikasi"
                className="press-effect rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-bold text-neutral-600 hover:bg-neutral-200"
              >
                Tutup
              </button>
            </div>

            {/* Daftar notifikasi */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
              {ordered.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-orange-50">
                    <Bell className="h-6 w-6 text-orange-300" />
                  </span>
                  <p className="text-sm font-bold text-neutral-700">Belum ada notifikasi</p>
                  <p className="max-w-[260px] text-xs leading-relaxed text-neutral-500">
                    Kabar pesanan baru, pembayaran, status masakan &amp; chat akan
                    terkumpul di sini — termasuk yang datang saat aplikasi tertutup.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {ordered.map((e, i) => {
                    const { icon: Icon, color } = roleIcon(e.kind);
                    const unread = unreadIds.has(e.ts) && i < unreadIds.size + 60;
                    return (
                      <li key={`${e.ts}-${i}`}>
                        <button
                          onClick={() => openEntry(e)}
                          className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${
                            unread
                              ? "border-orange-200 bg-orange-50/70 hover:bg-orange-100/70"
                              : "border-neutral-100 bg-white hover:bg-neutral-50"
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${color}`}
                          >
                            <Icon className="h-4.5 w-4.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-[13px] font-bold text-neutral-900">
                                {e.title}
                              </span>
                              {unread && (
                                <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                              )}
                            </span>
                            <span className="mt-0.5 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-neutral-600">
                              {e.body}
                            </span>
                            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                              {timeLabel(e.ts)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Kaki sheet */}
            {entries.length > 0 && (
              <div className="border-t border-orange-100 px-5 py-3">
                {confirmClear ? (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-neutral-600">
                      Kosongkan seluruh riwayat notifikasi?
                    </p>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => setConfirmClear(false)}
                        className="press-effect rounded-full bg-neutral-100 px-3 py-1.5 text-xs font-bold text-neutral-600"
                      >
                        Batal
                      </button>
                      <button
                        onClick={clearAll}
                        className="press-effect rounded-full bg-red-500 px-3 py-1.5 text-xs font-bold text-white"
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClear(true)}
                    className="press-effect mx-auto flex items-center gap-1.5 rounded-full bg-neutral-100 px-4 py-1.5 text-xs font-bold text-neutral-600 hover:bg-neutral-200"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Kosongkan Riwayat
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
