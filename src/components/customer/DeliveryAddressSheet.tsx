"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Bike, Check, MapPin, Search, X } from "lucide-react";
import {
  DELIVERY_AREAS,
  DELIVERY_AREA_LABEL,
  DELIVERY_FEE_PER_KM,
  billedKm,
  calcDeliveryFee,
  formatDistance,
} from "@/lib/delivery";
import { formatIDR } from "@/lib/types";
import { cn } from "@/lib/utils";

type DeliveryAddressSheetProps = {
  open: boolean;
  onClose: () => void;
  /** id area yang sedang dipilih di keranjang */
  selectedId: string;
  /** dipanggil saat pelanggan menekan salah satu area */
  onSelect: (areaId: string) => void;
};

/**
 * Popup "Pilih Alamat Pengantaran" — daftar gampong area layanan
 * Kec. Pidie, Kab. Pidie, Aceh 24151 beserta perkiraan jarak & ongkir
 * (Rp1.000/km, kelipatan jarak — dibulatkan ke atas per 1 km).
 */
export function DeliveryAddressSheet({ open, onClose, selectedId, onSelect }: DeliveryAddressSheetProps) {
  const prefersReduced = useReducedMotion();
  const [query, setQuery] = useState("");

  /** Tutup sheet + bersihkan pencarian supaya buka berikutnya mulai dari nol */
  const handleClose = () => {
    setQuery("");
    onClose();
  };

  /** Tutup dengan Escape */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, handleClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DELIVERY_AREAS;
    return DELIVERY_AREAS.filter((a) => a.gampong.toLowerCase().includes(q));
  }, [query]);

  // Portal ke <body> agar modal tidak terjebak stacking context `main` (z-10)
  // — selalu tampil DI ATAS navigasi bawah liquid glass (z-50) & header (z-40).
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="delivery-overlay"
          initial={prefersReduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReduced ? undefined : { opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-neutral-900/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Pilih Alamat Pengantaran"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          <motion.div
            initial={prefersReduced ? false : { y: 48, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={prefersReduced ? undefined : { y: 48, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="flex max-h-[86dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
          >
            {/* ===== KEPALA ===== */}
            <header className="relative shrink-0 bg-gradient-to-r from-orange-700 via-orange-600 to-orange-500 px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30">
                  <Bike className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black tracking-wide">Pilih Alamat Pengantaran</p>
                  <p className="truncate text-[11px] font-semibold text-orange-100">
                    Area layanan: {DELIVERY_AREA_LABEL}
                  </p>
                </div>
                <button
                  onClick={handleClose}
                  aria-label="Tutup"
                  className="press-effect flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/30"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
              {/* Banner aturan ongkir */}
              <p className="mt-2.5 rounded-xl bg-white/15 px-3 py-2 text-[11px] font-semibold leading-snug text-white ring-1 ring-white/25">
                🛵 Ongkir {formatIDR(DELIVERY_FEE_PER_KM)}/km — berlaku kelipatan jarak
                (dibulatkan ke atas per 1 km).
              </p>
            </header>

            {/* ===== PENCARIAN ===== */}
            <div className="shrink-0 border-b border-orange-50 px-4 pb-3 pt-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-orange-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cari gampong… (cth: Tijue, Paloh)"
                  aria-label="Cari gampong"
                  className="h-10 w-full rounded-xl border border-orange-200 bg-orange-50/50 pl-9 pr-3 text-base font-semibold text-neutral-800 outline-none placeholder:font-normal placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:ring-orange-400"
                />
              </div>
            </div>

            {/* ===== DAFTAR AREA ===== */}
            <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
              {filtered.length === 0 ? (
                <p className="py-10 text-center text-sm text-neutral-400">
                  Gampong tidak ditemukan — area layanan hanya Kec. Pidie 24151.
                </p>
              ) : (
                <div className="space-y-2">
                  {filtered.map((a) => {
                    const active = a.id === selectedId;
                    const km = billedKm(a.distanceKm);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          onSelect(a.id);
                          handleClose();
                        }}
                        aria-pressed={active}
                        className={cn(
                          "press-effect flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all",
                          active
                            ? "border-orange-500 bg-orange-50 ring-2 ring-orange-200"
                            : "border-orange-100 bg-white hover:border-orange-300"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                            active ? "bg-orange-600 text-white" : "bg-orange-100 text-orange-600"
                          )}
                        >
                          <MapPin className="h-4.5 w-4.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-neutral-800">
                            {a.gampong}
                          </span>
                          <span className="block truncate text-[11px] font-semibold text-neutral-400">
                            ± {formatDistance(a.distanceKm)} dari toko • {km} km × {formatIDR(DELIVERY_FEE_PER_KM)}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={cn("block text-sm font-black", active ? "text-orange-700" : "text-neutral-700")}>
                            {formatIDR(calcDeliveryFee(a.distanceKm))}
                          </span>
                          <span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400">
                            ongkir
                          </span>
                        </span>
                        {active && (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-600 text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="mt-3 text-center text-[10px] leading-snug text-neutral-300">
                Jarak merupakan perkiraan dari toko (Simpang Camat, Gampong Tijue).
                Di luar area {DELIVERY_AREA_LABEL} belum dilayani.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
