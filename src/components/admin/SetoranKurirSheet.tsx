"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bike,
  CheckCircle2,
  Clock,
  HandCoins,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useNoticeStore } from "@/lib/store";
import { formatDateTime, formatIDR } from "@/lib/types";
import { cn } from "@/lib/utils";

export type SetoranKurirSheetProps = {
  open: boolean;
  onClose: () => void;
};

/** Data dari GET /api/courier/setoran (admin) */
type SetoranAdminData = {
  perKurir: Array<{
    courierId: string | null;
    courierName: string;
    amount: number; // uang menu yang harus disetor
    ongkir: number; // pendapatan kurir (tidak disetor)
    count: number;
  }>;
  riwayat: Array<{
    id: string;
    amount: number;
    ongkir: number;
    orderCount: number;
    note: string | null;
    createdAt: string;
    confirmedAt: string | null;
    courier: { name: string };
  }>;
};

/**
 * Sheet "Setoran Kurir" (khusus Admin/Owner — Profil ▸ Setoran Kurir).
 *
 * Mengelola uang COD (bayar di tempat) yang dipegang kurir:
 *  - Rekap PER kurir: uang menu yang masih harus disetor ke admin +
 *    ongkir milik kurir sendiri (PENDAPATAN KURIR — tidak ikut disetor).
 *  - Riwayat setoran kurir dengan tombol "Tandai Diterima" — konfirmasi
 *    uang fisik benar-benar sudah diterima admin.
 *
 * Aturan uang: kurir setor NOMINAL MENU (total − ongkir); ongkir tetap
 * milik kurir (lihat src/lib/courier-setoran.ts).
 */
export function SetoranKurirSheet({ open, onClose }: SetoranKurirSheetProps) {
  const prefersReduced = useReducedMotion();
  const showNotice = useNoticeStore((s) => s.show);
  const [data, setData] = useState<SetoranAdminData | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/courier/setoran", { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  /** Admin menandai setoran COD kurir sebagai DITERIMA (uang di tangan) */
  const confirmSetoran = async (id: string, courierName: string, amount: number) => {
    setConfirming(id);
    try {
      const res = await apiFetch(`/api/courier/setoran/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      if (!res.ok) throw new Error();
      await load();
      showNotice({
        type: "success",
        title: "Setoran Dikonfirmasi ✓",
        message: `Setoran ${formatIDR(amount)} dari ${courierName} tertandai diterima.`,
      });
    } catch {
      showNotice({
        type: "error",
        title: "Gagal Konfirmasi",
        message: "Coba lagi sebentar — kalau tetap gagal, periksa koneksi.",
      });
    } finally {
      setConfirming(null);
    }
  };

  // Escape untuk tutup
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const perKurir = data?.perKurir ?? [];
  const riwayat = data?.riwayat ?? [];
  const totalTunggak = perKurir.reduce((s, k) => s + k.amount, 0);
  const menungguKonfirmasi = riwayat.filter((r) => !r.confirmedAt).length;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="setoran-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Setoran Kurir"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={prefersReduced ? false : { y: 48, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={prefersReduced ? undefined : { y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            {/* ===== KEPALA ===== */}
            <header className="relative shrink-0 bg-gradient-to-r from-amber-700 via-amber-600 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30">
                  <HandCoins className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black tracking-wide">Setoran COD Kurir</p>
                  <p className="truncate text-[11px] font-semibold text-amber-100">
                    {totalTunggak > 0
                      ? `${formatIDR(totalTunggak)} uang menu belum disetor`
                      : menungguKonfirmasi > 0
                        ? `${menungguKonfirmasi} setoran menunggu konfirmasimu`
                        : "Semua setoran rapi ✓"}
                  </p>
                </div>
                <button
                  onClick={() => void load()}
                  aria-label="Muat ulang"
                  className="press-effect flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/30"
                >
                  <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                </button>
                <button
                  onClick={onClose}
                  aria-label="Tutup"
                  className="press-effect flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/30"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
              <p className="mt-2 rounded-xl bg-black/20 px-3 py-1.5 text-[10px] font-semibold leading-snug text-amber-50">
                Kurir menyetor <b>nominal menu</b> (total − ongkir). <b>Ongkir = pendapatan kurir</b> —
                tidak ikut disetor, tidak dihitung di sini.
              </p>
            </header>

            {/* ===== ISI ===== */}
            <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
              {loading && !data ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm font-bold text-neutral-400">
                  <Loader2 className="h-5 w-5 animate-spin text-amber-500" /> Memuat setoran…
                </div>
              ) : (
                <div className="space-y-4">
                  {/* ===== Uang yang masih di tangan kurir ===== */}
                  <section>
                    <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-neutral-500">
                      Masih di Tangan Kurir
                    </p>
                    {perKurir.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/60 px-4 py-4 text-[12px] font-semibold text-emerald-700">
                        ✓ Tidak ada uang COD tertunggak — semua kurir sudah menyetor.
                      </p>
                    ) : (
                      <ul className="overflow-hidden rounded-2xl border border-amber-100">
                        {perKurir.map((k, i) => (
                          <li
                            key={k.courierId ?? "x"}
                            className={cn(
                              "flex items-center gap-3 bg-white px-3.5 py-3",
                              i > 0 && "border-t border-amber-50"
                            )}
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-[13px] font-black text-amber-700">
                              {k.courierName.charAt(0).toUpperCase()}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-black text-neutral-700">
                                {k.courierName}
                              </p>
                              <p className="text-[11px] text-neutral-400">
                                {k.count} pesanan COD belum disetor
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-sm font-black text-amber-700">{formatIDR(k.amount)}</p>
                              {k.ongkir > 0 && (
                                <p className="text-[10px] font-bold text-emerald-600">
                                  +ongkir {formatIDR(k.ongkir)} milik kurir
                                </p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  {/* ===== Riwayat setoran + konfirmasi ===== */}
                  <section>
                    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-neutral-500">
                      <Clock className="h-3.5 w-3.5" /> Riwayat Setoran
                      {menungguKonfirmasi > 0 && (
                        <span className="rounded-full bg-amber-600 px-2 py-0.5 text-[9px] font-black text-white">
                          {menungguKonfirmasi} menunggu konfirmasi
                        </span>
                      )}
                    </p>
                    {riwayat.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 px-4 py-4 text-[12px] font-semibold text-neutral-400">
                        Belum ada setoran masuk. Kurir menekan "Setor ke Admin" di berandanya lalu uang
                        tercatat di sini.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {riwayat.map((r) => (
                          <li
                            key={r.id}
                            className="rounded-2xl border border-neutral-100 bg-white px-3.5 py-3 shadow-sm"
                          >
                            <div className="flex items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-[13px] font-black text-neutral-600">
                                {r.courier.name.charAt(0).toUpperCase()}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-black text-neutral-700">
                                  {r.courier.name} • {formatIDR(r.amount)}
                                  <span className="font-semibold text-neutral-400">
                                    {" "}
                                    ({r.orderCount} pesanan)
                                  </span>
                                </p>
                                <p className="truncate text-[10px] text-neutral-400">
                                  {formatDateTime(r.createdAt)}
                                  {r.ongkir > 0 ? ` • ongkir ${formatIDR(r.ongkir)} milik kurir` : ""}
                                  {r.note ? ` • ${r.note}` : ""}
                                </p>
                              </div>
                              {r.confirmedAt ? (
                                <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                                  <CheckCircle2 className="h-3 w-3" /> Diterima
                                </span>
                              ) : (
                                <button
                                  onClick={() =>
                                    void confirmSetoran(r.id, r.courier.name, r.amount)
                                  }
                                  disabled={confirming === r.id}
                                  className="press-effect shrink-0 rounded-full bg-amber-600 px-3 py-1.5 text-[10px] font-black text-white shadow-sm hover:bg-amber-700 disabled:opacity-60"
                                >
                                  {confirming === r.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    "Tandai Diterima"
                                  )}
                                </button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <p className="flex items-start gap-1.5 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-[10px] leading-relaxed text-amber-700">
                    <Bike className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Setoran dihitung ulang otomatis setiap kurir menyelesaikan antaran COD — uang masuk
                    kantong kurir, lalu kosong lagi saat kurir menekan "Setor ke Admin". Konfirmasi di
                    sini hanya menandai uang fisik sudah diterima, tidak mengubah jumlah.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
